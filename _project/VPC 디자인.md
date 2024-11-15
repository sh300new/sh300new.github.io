---
title: AWS VPC 디자인 및 보안정책 적용 자동화
date: 2024-11-10 최초 작성일 수동 입력
last_modified_at: 2024-11-10 # GitHub Actions로 자동 업데이트
---

# AWS VPC 디자인 및 보안정책 적용 자동화

---

## 디자인

한국의 금융권 컴플라이언스는 망분리에 유난히 집착한다.
그들은 아직 레거시 인프라 구조에 머물러 있기 때문에 IP와 포트로 트래픽 막는 것을 좋아한다.
컴플라이언스에 대응할때 그러한 우리의 노력을 보여줘야 한다.
과거에는 필요한 정책을 한땀한땀 넣어야 했지만 aws는 매우 편리한 cli 인터페이스를 제공한다.
그래서 최소한의 리소스를 이용하여 컴플라이언스에 대응하기 위해 VPC를 분리하고, 트래픽 수집 -> 보안정책 적용을 자동화 하였다.

## VPC 디자인

**1. VPC 분리 및 tgw를 통한 연결**  
   - AWS는 기본적으로 같은 VPC 내의 로컬 통신은 모두 가능하기 때문에 필요에 따라 VPC를 나눴다.
   - 특히, RDS 들은 개별 DB마다 엔드포인트를 만들고 내부 통신으로 구성했다.
   - 또한 모든 VPC들은 tgw로 연결했으며, 불필요한 통신이 발생하지 않게 하기 위해서 필요한 네트워크 대역에 대해서만 서브넷에 rt을 넣었다.

**2. 서브넷 디자인**  
   - 일반적인 구성 방법대로 IP 대역을 4개로 나눠서 앞 IP 대역 2개로 public subnet을 만들고 뒷 IP 2개로 private subnet 대역을 만들었다.
   - IGW를 생성하여 VPC와 연결하고, public subnet에 라우팅을 넣고, NAT gw도 생성하였다.
   - private subnet에 nat gw에 대한 라우팅을 넣어 완성하였다.
   - 보안을 위해 tgw attachment는 private subnet에 생성하고, 필요한 rt만 추가했다.
   - 필요한 경우 proxy subnet을 추가로 만들고, private subnet이 아닌 proxy subnet에 NAT gw를 추가하여 private subnet에서는 proxy가 아니면 통신이 안되도록 설계하였다.

## 보안정책 적용 자동화

**1. VPC flowlog를 이용한 보안정책 적용**  
   - vpc flow log를 boto3로 읽고, 필요한 sg와 nacl을 넣는 스크립트이다.
   - 다만 nacl과 sg는 최대 갯수가 각각 20개, 60개로 적기 때문에 줄이는 로직도 넣었지만, 현실적으로 ip 병합 등은 기계로 하는데 한계가 있다.
   - 그래서 이 스크립트를 잘 이해하여 각자 필요에 맞게 바꿔서 활용하면 도움이 될 것이다.
<link rel="stylesheet" href="/assets/styles.css">

<div class="code-container">
  <button onclick="toggleCode(this)" class="toggle-btn" data-code="code-block-1">vpc flow log를 읽고 sg, nacl 적용.py</button>
  <pre id="code-block-1" class="code-block">
    <code>
import boto3
import subprocess
import json
from collections import Counter

# AWS 세션 설정
session = boto3.Session(region_name="ap-northeast-2")  # 서울 리전
ec2 = session.client('ec2')

# 대상 보안 그룹 및 NACL ID 설정
SECURITY_GROUP_ID = "sg-xxxxxxxx"
NACL_ID = "acl-xxxxxxxx"

def fetch_vpc_flow_logs(log_group_name, time_range="24h"):
    """
    AWS CLI를 사용하여 VPC Flow Logs 데이터를 수집하고, IP와 포트를 추출합니다.
    """
    cmd = [
        "aws", "logs", "filter-log-events",
        "--log-group-name", log_group_name,
        "--start-time", "24h"  # 지난 24시간 데이터 수집
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    log_data = json.loads(result.stdout)
    
    # 목적지 IP와 포트 수집
    ip_port_list = []
    for event in log_data["events"]:
        message = event["message"].split()
        dest_ip = message[4]  # 대상 IP (예시)
        dest_port = int(message[5])  # 대상 포트 (예시)
        ip_port_list.append((dest_ip, dest_port))
    
    return ip_port_list

def manage_security_group_rules(ip_port_list):
    """
    보안 그룹에 규칙을 추가하고, 최대 제한을 확인 후 필요 시 병합 또는 삭제합니다.
    """
    sg_rules = ec2.describe_security_group_rules(Filters=[{"Name": "group-id", "Values": [SECURITY_GROUP_ID]}])["SecurityGroupRules"]
    
    if len(sg_rules) + len(ip_port_list) > 60:
        # 기존 규칙 중 빈번하지 않은 포트와 IP를 삭제
        most_common = Counter(ip_port_list).most_common(60)  # 상위 60개만 남기기
        ip_port_list = [ip for ip, _ in most_common]
    
    # 규칙 추가
    for ip, port in ip_port_list:
        ec2.authorize_security_group_ingress(
            GroupId=SECURITY_GROUP_ID,
            IpProtocol="tcp",
            FromPort=port,
            ToPort=port,
            CidrIp=f"{ip}/32"
        )

def manage_nacl_rules(ip_port_list):
    """
    NACL에 규칙을 추가하고, 최대 제한을 확인 후 필요 시 병합 또는 삭제합니다.
    """
    nacl_entries = ec2.describe_network_acls(NetworkAclIds=[NACL_ID])["NetworkAcls"][0]["Entries"]
    
    if len(nacl_entries) + len(ip_port_list) > 20:
        # 기존 규칙 중 빈번하지 않은 포트와 IP를 삭제
        most_common = Counter(ip_port_list).most_common(20)  # 상위 20개만 남기기
        ip_port_list = [ip for ip, _ in most_common]
    
    # 규칙 추가
    for ip, port in ip_port_list:
        ec2.create_network_acl_entry(
            NetworkAclId=NACL_ID,
            RuleNumber=100 + port,  # 포트 번호를 규칙 번호로 활용
            Protocol="6",  # TCP 프로토콜
            RuleAction="allow",
            Egress=False,
            CidrBlock=f"{ip}/32",
            PortRange={"From": port, "To": port}
        )

def main():
    # VPC Flow Logs 데이터를 수집
    log_group_name = "VPC_FLOW_LOG_GROUP_NAME"  # VPC Flow Log 그룹명 입력
    ip_port_list = fetch_vpc_flow_logs(log_group_name)
    
    # 보안 그룹 및 NACL 규칙 관리
    manage_security_group_rules(ip_port_list)
    manage_nacl_rules(ip_port_list)

# 실행
if __name__ == "__main__":
    main()
</code>
  </pre>
  <button onclick="copyCode(this)" class="copy-btn" data-copy="code-block-1" style="display: none;">Copy</button>
</div>

**2. 인스턴스에서 네트워크 트래픽을 기록하여 보안정책 생성**  
   - vpc flowlog에는 생각보다 안잡히는 트래픽이 꽤 있다. 일단 공식적으로 icmp protocol만 기록이 안된다고 하는데, 패킷 길이를 기준인지, vpc flowlog만 가지고 보안 정책을 적용하면 대부분 문제가 생겼다.
   - 다만 vpc flowlog를 통해 구현하는 것이 훨씬 간편하고 넓은 범위에 적용 가능하기 때문에 vpc flowlog를 통해 nacl과 sg를 적용하고, 통신에 문제가 있는 인스턴스들에 대해서만 추가로 이 방법을 사용하였다.
   - 인프라를 구성하고 있는 os가 대략적으로 비슷하다면, 코드를 실행할 수 있는 형태로 변환해서 활용하면 시간을 절약할 수 있다.
<link rel="stylesheet" href="/assets/styles.css">

<div class="code-container">
  <button onclick="toggleCode(this)" class="toggle-btn" data-code="code-block-2">트래픽 수집 후 저장.py</button>
  <pre id="code-block-1" class="code-block">
    <code>
import psutil
import time
from datetime import datetime, timedelta

def collect_dest_ip_port(interface_name, interval_minutes=5, duration_hours=24, output_file="network_data.log"):
    # 종료 시간 설정
    end_time = datetime.now() + timedelta(hours=duration_hours)
    
    with open(output_file, "w") as file:
        file.write("Timestamp, Destination IP, Port\n")
        
        while datetime.now() < end_time:
            # 현재 시간 기록
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            # 네트워크 연결 정보 가져오기
            connections = psutil.net_connections(kind="inet")
            
            # 지정된 인터페이스의 목적지 IP와 포트 정보 수집
            for conn in connections:
                if conn.raddr and conn.type == psutil.SOCK_STREAM:  # TCP 연결만
                    dest_ip, dest_port = conn.raddr
                    # 파일에 기록
                    file.write(f"{timestamp}, {dest_ip}, {dest_port}\n")
                    
            # 변경 사항 저장
            file.flush()
            
            # 5분 간격으로 대기
            time.sleep(interval_minutes * 60)

# 예시 실행: "eth0" 인터페이스에서 수집 (인터페이스 이름은 환경에 따라 다를 수 있음)
collect_dest_ip_port("eth0")
</code>
  </pre>
  <button onclick="copyCode(this)" class="copy-btn" data-copy="code-block-2" style="display: none;">Copy</button>
</div>


## 운영 단계

1. **AWS 엔드포인트 관련 이슈**  
   - VPC 디자인이 끝난 후 운영 중, RDS에 대한 추가 연결이 필요하여 연결을 설정하는데 timeout이 발생했다.
   - 인터넷에 대한 연결은 가능했고, vpc flowlog 상에서도 리젝 로그가 없었는데 이상했다.
   - RDS 연결이 필요한 인스턴스에서 nslookup을 해보자 놀랍게도 프라이빗 IP가 확인됐다.
   - 그 이유는, RDS 엔드포인트건, 어떤 엔드포인트건 만들면 그 계정 안에 있는 모든 DNS에 해당 서비스는 엔드포인트 IP를 바라보게 DNS가 전파된다.
   - 그래서 엔드포인트를 추가할지 고민했지만, 엔드포인트가 있는 네트워크와 연결해도 무방했기에, TGW를 통해 엔드포인트와 네트워크를 연결했다.

2. **TGW를 연결한 VPC간 네트워크 연결 관련**
   - TGW는 VPC를 연결하는 도구로 매우 유용하다.
   - 잘 활용하면 매우 좋지만 간과하기 쉬운 부분이 TGW attachment rt table이다.
   - TGW는 vpc들을 attachment라는 리소스를 통해 연결하는데, 이 리소스들도 각각 rt을 가지고 있다.
   - 보통 attachment를 생성하면 각 ip 대역에 대해 rt을 tgw와 attachment에 자동으로 만들어 주지만 종종 필요에 의해 별도의 rt을 추가할 경우가 있다.
   - 이때 resource instance sg -> resource nacl -> resource subnet rt -> tgw rt -> destination subnet rt -> destination nacl -> destination sg 순으로 보통 검사를 하는데 이때 꼭 각 attachment에 대한 rt도 확인해야 한다.