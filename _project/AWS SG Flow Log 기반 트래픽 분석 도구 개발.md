---
title: AWS SG Flow Log 기반 트래픽 분석 도구 개발
date: 2025-06-25
last_modified_at: 2025-06-25
---

# AWS SG Flow Log 기반 트래픽 분석 도구 개발

작성일: {{ page.date | date: '%Y-%m-%d' }}  
마지막 수정: {{ page.last_modified_at | date: '%Y-%m-%d' }}

---

## 디자인

기존 AWS 보안 그룹(Security Group)은 허용된 포트/대역에 비해 실제 사용되는 트래픽 정보가 불분명했다.  
특히, 인프라 유지보수 시 불필요하게 열린 포트나, 반대로 필요하지만 누락된 규칙을 식별하는 작업이 수동으로 이루어지고 있었고,  
운영 환경에서는 허용된 포트 수가 많아 보안 그룹 최적화에 어려움이 있었다.

이 문제를 해결하기 위해 **VPC Flow Log 기반으로 실제 트래픽 패턴을 분석**하여  
보안 그룹 규칙을 자동으로 추천하는 도구를 개발했다.  
주요 목적은 다음과 같다:

- 실제 허용된 트래픽을 기준으로 보안 그룹 룰 정비  
- 사용되지 않는 포트를 시각적으로 식별  
- 내부/외부 트래픽 구분을 통한 접근 제어 정책 보완

---

## 구축 단계

**1. 요구사항 정의**  
   - 특정 보안 그룹 ID를 기준으로 동작해야 하며, 연결된 ENI(Network Interface) 전체에 대해 로그 분석 필요  
   - CloudWatch Log Insights를 사용해 **최근 일주일간의 ACCEPT 로그**만 필터링  
   - 분석 대상 포트는 전체 또는 지정한 포트만 선택 가능하도록 설계

**2. 구현 방식**  
   - boto3를 사용하여 AWS 리소스 정보 및 로그 조회  
   - Security Group 정책 파싱 → 허용된 포트/대역 정보 추출  
   - 연결된 ENI 목록 및 해당 ENI가 속한 VPC의 Flow Log 설정 확인  
   - CloudWatch Logs Insights 쿼리 생성 및 실행 → 트래픽 샘플 수집
   - 인바운드/아웃바운드 판별 기준은 다음과 같음:
     - **인바운드**: 목적지가 내부 IP + 허용 포트 + 허용 CIDR  
     - **아웃바운드**: 출발지가 내부 IP + 허용 포트 + 허용 CIDR

**3. 트래픽 요약 및 추천 룰 생성**  
   - 동일 /24 대역 내 IP가 3개 이상일 경우, 대역으로 요약  
   - 고포트(1024 이상)는 포트 그룹 단위로 병합 (동일 그룹 내 트래픽 IP가 10개 이상일 경우)  
   - 다음 형식으로 추천 룰을 출력:
     - `- allow tcp port 443 from 203.0.113.10`
     - `- allow tcp ports 20000~30000 from 10.0.0.0/24`

<div class="code-container">
  <button onclick="toggleCode(this)" class="toggle-btn" data-code="code-block-1">asg_userdata_update.py</button>
  <pre id="code-block-1" class="code-block">
    <code>

# -*- coding: utf-8 -*-
"""
AWS SG Flow Log Analyzer

이 스크립트는 지정한 AWS 보안 그룹(Security Group)에 연결된 ENI(Elastic Network Interface)의 VPC Flow Log를 조회하여
허용된 인바운드/아웃바운드 트래픽 패턴을 분석하고, 실제로 수신/발신된 IP와 포트를 바탕으로
보안 그룹 규칙 최적화(추천) 문구를 출력합니다.

사용 방법:
1. AWS CLI 설정(profile)에 접근 권한이 있어야 합니다.
2. 스크립트 상단의 설정 섹션에서 아래 변수를 필요에 맞게 변경합니다:
   - sg_id        : 분석할 보안 그룹 ID (예: sg-0123456789abcdef0)
   - region       : 리전 이름 (예: ap-northeast-2)
   - aws_profile  : AWS CLI 프로파일 이름 (예: default)
   - TARGET_PORTS : 분석할 포트 리스트 (빈 리스트([])이면 전체 포트를 분석)
3. VPC에 Flow Log가 활성화되어 있어야 합니다. Log Group 이름과 ENI ID를 자동으로 검색합니다.
4. python aws_sg_flow_analyzer.py 를 실행하면 인바운드/아웃바운드 추천 규칙이 출력됩니다.

필요 라이브러리:
- boto3

"""
import boto3
import time
import ipaddress
from collections import defaultdict

# ── 설정 ──
# 분석할 보안 그룹 ID, AWS 리전 및 CLI 프로파일 설정
sg_id         = "sg-0b65d5989105d90b7"
region        = "ap-northeast-2"
aws_profile   = "default"
# TARGET_PORTS에 지정한 포트만 분석, 빈 리스트([])이면 모든 포트 분석
TARGET_PORTS  = []

# ── 내부망 판단용 네트워크 대역
internal_networks = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
]

# ── 포트 그룹(출력 시 범위 병합 기준)
PORT_GROUPS = [
    (1024, 10000),
    (10001, 20000),
    (20001, 30000),
    (30001, 40000),
    (40001, 50000),
    (50001, 65535),
]

# 이하 함수별 역할:

def get_allowed_ports_and_cidrs(ec2, sg_id):
    """
    지정한 SG 정책에서 인바운드/아웃바운드 허용 포트 및 CIDR 매핑을 추출합니다.
    - IpPermissions, IpPermissionsEgress 항목을 순회하여 포트 범위 확장 후 포트별 허용 CIDR 목록 작성
    - TARGET_PORTS 지정 시 해당 포트만 필터링
    """
    sg = ec2.describe_security_groups(GroupIds=[sg_id])["SecurityGroups"][0]

    in_ports, out_ports = set(), set()
    in_cidrs_map  = defaultdict(set)
    out_cidrs_map = defaultdict(set)

    def _expand_ports(perm):
        # 프로토콜 -1은 모든 포트
        if perm.get("IpProtocol") == "-1":
            return range(0, 65536)
        return range(perm["FromPort"], perm["ToPort"] + 1)

    # 인바운드 룰 처리
    for perm in sg.get("IpPermissions", []):
        ports = _expand_ports(perm)
        cidrs = [r["CidrIp"] for r in perm.get("IpRanges", [])]
        for p in ports:
            in_ports.add(p)
            for c in cidrs:
                in_cidrs_map[p].add(c)

    # 아웃바운드 룰 처리
    for perm in sg.get("IpPermissionsEgress", []):
        ports = _expand_ports(perm)
        cidrs = [r["CidrIp"] for r in perm.get("IpRanges", [])]
        for p in ports:
            out_ports.add(p)
            for c in cidrs:
                out_cidrs_map[p].add(c)

    # 특정 포트만 분석할 경우 필터링
    if TARGET_PORTS:
        in_ports  &= set(TARGET_PORTS)
        out_ports &= set(TARGET_PORTS)
        in_cidrs_map  = {p: in_cidrs_map[p]  for p in in_ports}
        out_cidrs_map = {p: out_cidrs_map[p] for p in out_ports}

    return in_ports, out_ports, in_cidrs_map, out_cidrs_map


def get_enis_and_log_group_by_sg(sg_id, ec2):
    """
    보안 그룹에 연관된 ENI 목록과 VPC Flow Log LogGroup 이름을 반환합니다.
    - ENI가 없으면 None, [] 리턴
    - Flow Log가 설정되어 있지 않으면 LogGroup None
    """
    enis = ec2.describe_network_interfaces(
        Filters=[{"Name": "group-id", "Values": [sg_id]}]
    )['NetworkInterfaces']
    if not enis:
        return None, []

    vpc_id  = enis[0]['VpcId']
    eni_ids = [eni['NetworkInterfaceId'] for eni in enis]

    flow_logs = ec2.describe_flow_logs(
        Filters=[{"Name": "resource-id", "Values": [vpc_id]}]
    )['FlowLogs']
    if not flow_logs:
        return None, eni_ids

    return flow_logs[0]['LogGroupName'], eni_ids


def build_query(eni_ids):
    """CloudWatch Logs Insights 쿼리 문자열 생성"""
    ids = ", ".join(f"'{e}'" for e in eni_ids)
    return f"""
      fields dstPort, srcAddr, dstAddr
      | filter interfaceId in [{ids}] and action='ACCEPT'
      | sort @timestamp desc
    """


def is_internal(ip):
    try:
        ip_obj = ipaddress.ip_address(ip)
        return any(ip_obj in net for net in internal_networks)
    except:
        return False


def ip_in_cidrs(ip, cidr_list):
    try:
        ip_obj = ipaddress.ip_address(ip)
        return any(ip_obj in ipaddress.ip_network(c) for c in cidr_list)
    except:
        return False


def get_log_events(log_group, eni_ids, logs):
    """
    Flow Log Insights 쿼리 실행 후 결과를 반환
    - 최근 7일 데이터 조회
    """
    qid = logs.start_query(
        logGroupName=log_group,
        startTime=int(time.time()) - 86400 * 7,
        endTime=int(time.time()),
        queryString=build_query(eni_ids),
    )['queryId']
    while True:
        resp = logs.get_query_results(queryId=qid)
        if resp['status'] == 'Complete':
            return resp['results']
        time.sleep(2)


def split_inbound_outbound(results, in_ports, out_ports, in_cidrs_map, out_cidrs_map):
    """
    로그 결과를 인바운드/아웃바운드로 분리
    - IP 및 포트 조건에 따라 허용된 트래픽만 필터링
    """
    in_data, out_data = defaultdict(list), defaultdict(list)

    for row in results:
        dstp = next((r['value'] for r in row if r['field']=='dstPort'), None)
        src  = next((r['value'] for r in row if r['field']=='srcAddr'), None)
        dst  = next((r['value'] for r in row if r['field']=='dstAddr'), None)
        if not dstp: continue
        try:
            port = int(dstp)
        except:
            continue

        # 인바운드 트래픽: 목적지 내부 & 포트 허용 & 출발지 IP가 허용 CIDR 내
        if is_internal(dst) and port in in_ports:
            if ip_in_cidrs(src, in_cidrs_map.get(port, [])):
                in_data[port].append(src)

        # 아웃바운드 트래픽: 출발지 내부 & 포트 허용 & 목적지 IP 허용 CIDR 내
        elif is_internal(src) and port in out_ports:
            if ip_in_cidrs(dst, out_cidrs_map.get(port, [])):
                out_data[port].append(dst)

    return in_data, out_data


def summarize_ips(ips):
    """
    IP 리스트를 /24 네트워크 단위로 그룹핑하여 요약
    - 동일 /24에 >=3개 IP 있으면 네트워크 대역으로 표시
    """
    grouped = defaultdict(list)
    for ip in ips:
        try:
            net = ipaddress.ip_interface(f"{ip}/24").network
            grouped[net].append(ip)
        except:
            pass

    result = []
    for net, members in grouped.items():
        if len(members) >= 3:
            result.append(str(net))
        else:
            result.extend(members)
    return result


def group_ports(port_counts):
    """
    포트별 카운트를 기반으로 출력할 포트 목록 정리
    - 1024 이하 단일 포트, 1025 이상은 지정한 그룹 범위 내에서
      IP가 10개 이상이면 전체 범위로 병합
    """
    singles = []
    grouped = defaultdict(list)
    for p in sorted(port_counts):
        if p <= 1023:
            singles.append(p)
        else:
            for s,e in PORT_GROUPS:
                if s<=p<=e:
                    grouped[(s,e)].append(p)
                    break
    merged_ranges = []
    for (s,e), lst in grouped.items():
        if len(lst) >= 10:
            merged_ranges.append([s,e])
        else:
            singles.extend(lst)
    # 인접 범위 병합
    merged_ranges.sort()
    merged=[]
    for s,e in merged_ranges:
        if not merged or s>merged[-1][1]+1:
            merged.append([s,e])
        else:
            merged[-1][1] = max(merged[-1][1], e)
    return singles, merged


def display_direction(name, data):
    """
    인바운드/아웃바운드 추천 규칙 출력
    """
    print(f"\n✅ {name} Recommendations:")
    port_counts = {p: len(ips) for p, ips in data.items()}
    singles, ranges = group_ports(port_counts)
    seen = set()

    # 단일 포트 출력
    for p in singles:
        for ip in summarize_ips(data[p]):
            rule = f"- allow tcp port {p} from {ip}"
            if rule not in seen:
                print(rule)
                seen.add(rule)

    # 범위 포트 출력
    for s,e in ranges:
        all_ips=[]
        for p in range(s, e+1):
            all_ips += data.get(p, [])
        for ip in summarize_ips(all_ips):
            rule = f"- allow tcp ports {s}~{e} from {ip}"
            if rule not in seen:
                print(rule)
                seen.add(rule)

if __name__ == "__main__":
    # AWS 세션 및 클라이언트 생성
    sess = boto3.Session(profile_name=aws_profile)
    ec2  = sess.client("ec2", region_name=region)
    logs = sess.client("logs", region_name=region)

    # 보안 그룹 룰, ENI, 로그 그룹 정보 조회
    in_ports, out_ports, in_cidrs, out_cidrs = get_allowed_ports_and_cidrs(ec2, sg_id)
    loggrp, eni_ids = get_enis_and_log_group_by_sg(sg_id, ec2)
    if not loggrp or not eni_ids:
        print("❌ ENI 또는 Flow Log 설정을 찾을 수 없습니다.")
        exit(1)

    # Flow Log에서 최근 일주일간 허용 기록 조회
    results = get_log_events(loggrp, eni_ids, logs)
    in_data, out_data = split_inbound_outbound(results, in_ports, out_ports, in_cidrs, out_cidrs)

    # 추천 규칙 출력
    display_direction("Inbound", in_data)
    display_direction("Outbound", out_data)

</code> </pre> <button onclick="copyCode(this)" class="copy-btn" data-copy="code-block-1" style="display: none;">Copy</button>

</div>

---

## 운영 단계

1. **Flow Log가 설정되지 않은 경우 예외 처리**  
   - Flow Log가 비활성화된 경우, 로그 그룹 또는 ENI를 찾을 수 없어 분석이 불가하다는 메시지를 출력하도록 구현됨

2. **SMB 포트 문제와 유사한 구성 고려**  
   - 내부 트래픽이 정상적으로 분석되지 않는 경우, Flow Log의 제한 또는 허용 룰 누락 가능성 고려  
   - 특히 보안 장비나 프록시로 트래픽이 NAT되었을 경우, 실제 IP 기반의 정확한 분석이 어려움

---

## 결론

이 스크립트를 통해 AWS 환경에서 **정적 정책 기반의 보안 그룹을 동적 트래픽 기반으로 재정비**할 수 있는 기반이 마련되었다.  
자동화 수준은 높지 않지만, CloudWatch Logs Insights의 쿼리 기능과 IP/포트 필터링을 조합해  
운영 중인 시스템의 보안 구성을 점검하는 데 유용하다.

향후 발전 방향:

- 시각화 도구와 연동 (예: 그래프, 히트맵 등)
- 실제 보안 그룹에 자동 반영 기능 추가 (예: boto3를 통한 SG 업데이트)
- CloudTrail과 연계하여 정책 변경 이력 추적 기능 추가
