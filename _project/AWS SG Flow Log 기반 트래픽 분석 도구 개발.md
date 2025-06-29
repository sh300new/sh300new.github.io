---

title: AWS SG Flow Log 기반 트래픽 분석 도구 개발
date: 2025-06-25
last\_modified\_at: 2025-06-25

---

# AWS SG Flow Log 기반 트래픽 분석 도구 개발

작성일: {{ page.date | date: '%Y-%m-%d' }}
마지막 수정: {{ page.last\_modified\_at | date: '%Y-%m-%d' }}

---

## 디자인

기존 AWS 보안 그룹(Security Group)은 허용된 포트/대역에 비해 실제 사용되는 트래픽 정보가 불분명했다.
특히, 인프라 유지보수 시 불필요하게 열린 포트나, 반대로 필요하지만 누락된 규칙을 식별하는 작업이 수동으로 이루어지고 있었고,
운영 환경에서는 허용된 포트 수가 많아 보안 그룹 최적화에 어려움이 있었다.

이 문제를 해결하기 위해 **VPC Flow Log 기반으로 실제 트래픽 패턴을 분석**하여
보안 그룹 규칙을 자동으로 추천하는 도구를 개발했다.
주요 목적은 다음과 같다:

* 실제 허용된 트래픽을 기준으로 보안 그룹 룰 정비
* 사용되지 않는 포트를 시각적으로 식별
* 내부/외부 트래픽 구분을 통한 접근 제어 정책 보완

---

## 구축 단계

**1. 요구사항 정의**

* 특정 보안 그룹 ID를 기준으로 동작해야 하며, 연결된 ENI(Network Interface) 전체에 대해 로그 분석 필요
* CloudWatch Log Insights를 사용해 **최근 일주일간의 ACCEPT 로그**만 필터링
* 분석 대상 포트는 전체 또는 지정한 포트만 선택 가능하도록 설계

**2. 구현 방식**

* boto3를 사용하여 AWS 리소스 정보 및 로그 조회
* Security Group 정책 파싱 → 허용된 포트/대역 정보 추출
* 연결된 ENI 목록 및 해당 ENI가 속한 VPC의 Flow Log 설정 확인
* CloudWatch Logs Insights 쿼리 생성 및 실행 → 트래픽 샘플 수집
* 인바운드/아웃바운드 판별 기준은 다음과 같음:

  * **인바운드**: 목적지가 내부 IP + 허용 포트 + 허용 CIDR
  * **아웃바운드**: 출발지가 내부 IP + 허용 포트 + 허용 CIDR

**3. 트래픽 요약 및 추천 룰 생성**

* 동일 /24 대역 내 IP가 3개 이상일 경우, 대역으로 요약
* 고포트(1024 이상)는 포트 그룹 단위로 병합 (동일 그룹 내 트래픽 IP가 10개 이상일 경우)
* 다음 형식으로 추천 룰을 출력:

  * `- allow tcp port 443 from 203.0.113.10`
  * `- allow tcp ports 20000~30000 from 10.0.0.0/24`

---

## 위험 가능성이 있는 보안 그룹 탐지

VPC 전체에 존재하는 보안 그룹 중, 다음 조건에 해당하는 과도한 규칙을 포함한 보안 그룹을 탐지하고
연결된 리소스(EC2, Lambda, RDS, ECS 등)의 ENI를 기준으로 실제 사용처를 요약합니다.

* 모든 포트 또는 전체 포트 범위를 허용한 경우
* 0.0.0.0/0을 사용하면서 포트 범위를 설정한 경우

<div class="code-container">
  <button onclick="toggleCode(this)" class="toggle-btn" data-code="code-block-1">find_worng_sg.py</button>
  <pre id="code-block-1" class="code-block">
    <code>
"""
🔍 AWS VPC 보안 그룹 과도 허용 검사 및 연결 리소스 요약 스크립트

이 스크립트는 지정한 VPC 내의 모든 보안 그룹을 조회하여,
- 너무 넓은 범위(모든 프로토콜/모든 포트 또는 0.0.0.0/0 + 포트 범위)로 열린 규칙을 찾아내고,
- 해당 보안 그룹이 연결된 ENI(네트워크 인터페이스)를 통해 리소스(EC2, RDS, ECS, Lambda 등)를 유추하여 요약합니다.

── 설정 ──
  vpc_id        : 검사 대상 VPC ID (예: 'vpc-0123456789abcdef0')
  region        : AWS 리전 (예: 'ap-northeast-2')
  aws 프로파일 : boto3.Session(profile_name='...') 에서 사용될 프로파일 이름
──────────────────────────────────────────────────────────────────────────────
"""

import boto3
from collections import defaultdict

def get_resource_name_from_tags(tags, default):
    """태그 리스트에서 'Name' 태그 값을 반환하거나, 없으면 default를 돌려줍니다."""
    if tags:
        for tag in tags:
            if tag.get('Key') == 'Name' and tag.get('Value', '').strip():
                return tag['Value']
    return default

def is_overly_permissive(sg):
    """
    보안 그룹 sg 의 인바운드/아웃바운드 규칙을 검사하여,
    - 프로토콜 전체(-1) 또는 포트 정보 없음 → 모든 포트 열림
    - FromPort=0, ToPort=65535 → 모든 포트 열림
    - CidrIp='0.0.0.0/0' 이면서 FromPort != ToPort → 포트 범위 과도 열림
    위 조건을 만족하는 규칙 목록을 반환합니다.
    """
    offending_rules = []
    for direction, perms in [
        ('Inbound',  sg.get('IpPermissions', [])),
        ('Outbound', sg.get('IpPermissionsEgress', []))
    ]:
        for perm in perms:
            from_port = perm.get('FromPort')
            to_port   = perm.get('ToPort')
            ip_proto  = perm.get('IpProtocol')
            ip_ranges = perm.get('IpRanges', [])

            # 1) 전체 프로토콜(-1) 또는 포트 지정 없음 → 모든 포트
            is_all_ports = (ip_proto == '-1') or (from_port is None and to_port is None)
            if is_all_ports:
                offending_rules.append((direction, perm))
                continue

            # 2) 0~65535 로 열린 경우 → 모든 포트
            if from_port == 0 and to_port == 65535:
                offending_rules.append((direction, perm))
                continue

            # 3) 단일 포트가 아닌 포트 범위에 대해 0.0.0.0/0 으로 열린 경우
            for ip_range in ip_ranges:
                if ip_range.get('CidrIp') == '0.0.0.0/0' \
                        and from_port is not None and to_port is not None \
                        and from_port != to_port:
                    offending_rules.append((direction, perm))
                    break

    return offending_rules

def guess_resource_from_eni(eni, rds_instances, ecs_client=None, lambda_client=None):
    """
    ENI 정보로부터 연결된 리소스 유형을 추정합니다.
    - Lambda: Description에 'Lambda' 포함
    - RDS: rds_instances 네트워크 인터페이스 목록과 매칭
    - VPC Endpoint: InterfaceType == 'vpc_endpoint'
    - EC2: InterfaceType == 'interface' & Attachment.InstanceId 존재
    - ECS Task: Description이 ECS ARN 형식
    - 기타: 수동 확인 필요
    """
    desc = eni.get('Description', '')
    interface_type = eni.get('InterfaceType')
    instance_id = eni.get('Attachment', {}).get('InstanceId')
    eni_id = eni.get('NetworkInterfaceId')

    # Lambda 함수 식별 시도
    if 'Lambda' in desc:
        if lambda_client:
            try:
                for func in lambda_client.list_functions()['Functions']:
                    if func['FunctionName'] in desc:
                        return f"Lambda 함수 (이름: {func['FunctionName']})"
            except:
                pass
        return "Lambda 함수"

    # RDS 인스턴스 식별
    elif 'rds' in desc.lower():
        for rds in rds_instances:
            if eni_id in [
                iface['NetworkInterfaceId']
                for iface in rds.get('NetworkInterfaces', [])
            ]:
                return "RDS 인스턴스"
        return "RDS 인스턴스 (설명 기반 추정)"

    # VPC Endpoint 식별
    elif interface_type == 'vpc_endpoint':
        return "VPC Endpoint"

    # 일반 EC2 인스턴스
    elif interface_type == 'interface' and instance_id:
        return "EC2 인스턴스"

    # ECS 태스크 식별 시도
    elif desc.startswith("arn:aws:ecs:") and ecs_client:
        cluster_name = get_ecs_cluster_name_from_attachment(ecs_client, desc)
        if cluster_name:
            return f"ECS 태스크 (클러스터: {cluster_name})"
        return "ECS 태스크 (클러스터 확인 실패)"

    # 그 외
    else:
        return "기타 또는 수동 확인 필요"

def get_ecs_cluster_name_from_attachment(ecs_client, attachment_arn):
    """
    ECS 클러스터 목록을 순회하며 attachmentArn 과 매칭되는 태스크가 속한
    클러스터 이름을 찾아 반환합니다.
    """
    try:
        paginator = ecs_client.get_paginator('list_clusters')
        for page in paginator.paginate():
            for cluster_arn in page['clusterArns']:
                tasks = ecs_client.list_tasks(cluster=cluster_arn, desiredStatus='RUNNING')
                if not tasks['taskArns']:
                    continue
                desc = ecs_client.describe_tasks(cluster=cluster_arn, tasks=tasks['taskArns'])['tasks']
                for task in desc:
                    # task.attachments 또는 task.attachmentArn 매칭
                    if task.get('attachmentArn') == attachment_arn:
                        return cluster_arn.split('/')[-1]
                    for att in task.get('attachments', []):
                        if att.get('id') == attachment_arn.split('/')[-1]:
                            return cluster_arn.split('/')[-1]
    except:
        return None
    return None

# ── 설정 (필요에 맞게 수정) ──
vpc_id        = 'vpc-03554c010c6191b4f'
region        = 'ap-northeast-2'
aws_profile   = 'default'
# ───────────────────────────────

# AWS 세션 및 클라이언트 초기화
session       = boto3.Session(profile_name=aws_profile)
ec2_client    = session.client('ec2',    region_name=region)
rds_client    = session.client('rds',    region_name=region)
ecs_client    = session.client('ecs',    region_name=region)
lambda_client= session.client('lambda', region_name=region)

# VPC 이름 조회
vpc_desc = ec2_client.describe_vpcs(VpcIds=[vpc_id])['Vpcs'][0]
vpc_name = get_resource_name_from_tags(vpc_desc.get('Tags', []), 'Unnamed VPC')

# RDS 인스턴스별 ENI 정보 수집
rds_instances = []
for db in rds_client.describe_db_instances().get('DBInstances', []):
    info = {'DBInstanceIdentifier': db['DBInstanceIdentifier'], 'NetworkInterfaces': []}
    endpoint = db.get('Endpoint', {}).get('Address')
    if endpoint:
        try:
            enis = ec2_client.describe_network_interfaces(Filters=[
                {'Name': 'description', 'Values': [f"RDSNetworkInterface*{endpoint}*"]}
            ])['NetworkInterfaces']
            info['NetworkInterfaces'] = enis
        except:
            pass
    rds_instances.append(info)

# VPC 내 모든 보안 그룹 조회
security_groups = ec2_client.describe_security_groups(
    Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}]
)['SecurityGroups']

print(f"🔍 대상 VPC: {vpc_name} (ID: {vpc_id}) 내 과도하게 열린 보안 그룹 연결 리소스 목록\n")

# 각 보안 그룹 검사 및 결과 출력
for sg in security_groups:
    offending_rules = is_overly_permissive(sg)
    if not offending_rules:
        continue

    sg_name = get_resource_name_from_tags(sg.get('Tags', []), sg['GroupId'])
    print(f"\n- 보안 그룹: {sg_name} (ID: {sg['GroupId']})")
    print("  ▶ 과도하게 열린 규칙:")
    for direction, rule in offending_rules:
        fp = rule.get('FromPort', 'N/A')
        tp = rule.get('ToPort',   'N/A')
        cidrs = [r.get('CidrIp') for r in rule.get('IpRanges', [])]
        print(f"    - {direction}: 포트 {fp} ~ {tp}, CIDR {cidrs}")

    # 해당 SG가 연결된 ENI 조회
    enis = ec2_client.describe_network_interfaces(
        Filters=[{'Name': 'group-id', 'Values': [sg['GroupId']]}]
    )['NetworkInterfaces']

    # ENI별 예상 리소스 타입 분류
    resource_summary = defaultdict(list)
    for eni in enis:
        rtype = guess_resource_from_eni(eni, rds_instances, ecs_client, lambda_client)
        resource_summary[rtype].append(eni)

    # 요약 정보 출력
    print("  ▶ 연결된 리소스 요약:")
    for rtype, lst in resource_summary.items():
        print(f"    • {rtype}: {len(lst)}개")

    # 최대 5개의 ENI 샘플 출력
    print("  ▶ 리소스 샘플 (최대 5개):")
    count = 0
    for rtype, lst in resource_summary.items():
        for eni in lst:
            eni_id    = eni['NetworkInterfaceId']
            desc      = eni.get('Description', 'N/A')
            itype     = eni.get('InterfaceType', 'N/A')
            inst = eni.get('Attachment', {}).get('InstanceId', 'N/A')
            # ENI에 태그된 이름 추출 (EC2 인스턴스는 추가 조회)
            name_tag = get_resource_name_from_tags(
                eni.get('TagSet', eni.get('Tags', [])), ''
            )
            if not name_tag and inst != 'N/A' and rtype == "EC2 인스턴스":
                try:
                    tags = ec2_client.describe_instances(InstanceIds=[inst]) \
                        ['Reservations'][0]['Instances'][0].get('Tags', [])
                    name_tag = get_resource_name_from_tags(tags, '')
                except:
                    pass
            name_info = f" (이름: {name_tag})" if name_tag else ""
            print(f"    - ENI {eni_id}{name_info}, 타입={itype}, 인스턴스={inst}, 설명={desc}")
            count += 1
            if count >= 5:
                break
        if count >= 5:
            break
</code> </pre> <button onclick="copyCode(this)" class="copy-btn" data-copy="code-block-1" style="display: none;">Copy</button>
</div>
<script src="/assets/scripts.js"></script>



<div class="code-container">
  <button onclick="toggleCode(this)" class="toggle-btn" data-code="code-block-2">anal_flow_log.py</button>
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
sg_id         = ""
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

</code> </pre> <button onclick="copyCode(this)" class="copy-btn" data-copy="code-block-2" style="display: none;">Copy</button>
</div>
<script src="/assets/scripts.js"></script>

---

## 운영 단계

1. **Flow Log가 설정되지 않은 경우 예외 처리**

   * Flow Log가 비활성화된 경우, 로그 그룹 또는 ENI를 찾을 수 없어 분석이 불가하다는 메시지를 출력하도록 구현됨

2. **SMB 포트 문제와 유사한 구성 고려**

   * 내부 트래픽이 정상적으로 분석되지 않는 경우, Flow Log의 제한 또는 허용 룰 누락 가능성 고려
   * 특히 보안 장비나 프록시로 트래픽이 NAT되었을 경우, 실제 IP 기반의 정확한 분석이 어려움

---

## 결론

이 스크립트를 통해 AWS 환경에서 **정적 정책 기반의 보안 그룹을 동적 트래픽 기반으로 재정비**할 수 있는 기반이 마련되었다.
자동화 수준은 높지 않지만, CloudWatch Logs Insights의 쿼리 기능과 IP/포트 필터링을 조합해
운영 중인 시스템의 보안 구성을 점검하는 데 유용하다.

향후 발전 방향:

* 시각화 도구와 연동 (예: 그래프, 히트맵 등)
* 실제 보안 그룹에 자동 반영 기능 추가 (예: boto3를 통한 SG 업데이트)
* CloudTrail과 연계하여 정책 변경 이력 추적 기능 추가
* SG 과도 허용 탐지 결과를 기반으로 알림 또는 자동 수정 기능 연계






## 여기까지


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
