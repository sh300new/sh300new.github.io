---
title: ecs 리툴 eks 마이그레이션
date: 2023-10-29 # 최초 작성일 수동 입력
---

# ecs 서비스 eks 마이그레이션

---

작성일: {{ page.date | date: '%Y-%m-%d' }}  

---

## 디자인

수년전부터 회사의 염원은 eks를 도입하는 것이다.
ecs는 너무 제약이 많기 때문에 보다 유연한 시스템 구성을 위해 eks로 이관하는 것이다.
프로젝트 수행 방식은 먼저 eksctl을 통해 다양한 방식으로 생성/삭제를 반복 후 구축이 완료되면 역으로 Iac로 구성하는 방식을 택했다.
추가로 ecs에서 운영되고 있는 서비스 중 그나마 가장 간단한 리툴을 먼저 마이그레이션 하기로 했다.

---

## 구축 단계

**1. eks 생성**  
   - eksctl로 생성하되 언제나 그렇듯 수도 없이 부시고 만들고를 반복해야 하니 최대한 yaml 파일을 통해 만들려고 했다.
   - 또한 막상 생성해보니 노드그룹에서 노드의 ip를 지정할 수 없어서 최대한 작은 서브넷 ip 대역이 필요했고, 이를 위해 서브넷 ip 대역을 지정하고 싶었는데 그게 안돼서 vpc는 미리 만들었다.
   - vpc를 한번에 생성하면 좋지만 나같이 누군가는 실수할 수도 있기에 vpc와 관련된 리소스를 한번에 지울 수 있는 코드를 공유한다.
## delete all vpc resource.sh

<link rel="stylesheet" href="/assets/styles.css">

<div class="code-container">
  <button onclick="toggleCode()" class="toggle-btn">delete all vpc resource.sh</button>
  <pre id="code-block" class="code-block">
    <code>
VPC_ID="vpc-054b2b4f9d005926c"

# 1. 인터넷 게이트웨이 및 NAT 게이트웨이 해제 및 삭제
IGW_ID=$(aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$VPC_ID" --query "InternetGateways[0].InternetGatewayId" --output text)
if [ "$IGW_ID" != "None" ]; then
  aws ec2 detach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID
  aws ec2 delete-internet-gateway --internet-gateway-id $IGW_ID
fi

NAT_GW_IDS=$(aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$VPC_ID" --query "NatGateways[*].NatGatewayId" --output text)
for nat in $NAT_GW_IDS; do
  aws ec2 delete-nat-gateway --nat-gateway-id $nat
done

# 2. 서브넷 삭제
SUBNET_IDS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query "Subnets[*].SubnetId" --output text)
for subnet in $SUBNET_IDS; do
  aws ec2 delete-subnet --subnet-id $subnet
done

# 3. 라우팅 테이블 삭제 (메인 라우팅 테이블 제외)
ROUTE_TABLE_IDS=$(aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$VPC_ID" --query "RouteTables[?Associations[0].Main!=\`true\`].RouteTableId" --output text)
for route_table in $ROUTE_TABLE_IDS; do
  aws ec2 delete-route-table --route-table-id $route_table
done

# 4. 네트워크 ACL 삭제 (기본 ACL 제외)
ACL_IDS=$(aws ec2 describe-network-acls --filters "Name=vpc-id,Values=$VPC_ID" --query "NetworkAcls[?IsDefault!=\`true\`].NetworkAclId" --output text)
for acl in $ACL_IDS; do
  aws ec2 delete-network-acl --network-acl-id $acl
done

# 5. 보안 그룹 삭제 (기본 보안 그룹 제외)
SG_IDS=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" --query "SecurityGroups[?GroupName!='default'].GroupId" --output text)
for sg in $SG_IDS; do
  aws ec2 delete-security-group --group-id $sg
done

# 6. VPC 삭제
aws ec2 delete-vpc --vpc-id $VPC_ID
    </code>
  </pre>
  <button onclick="copyCode()" class="copy-btn">Copy</button>
</div>

<script src="/assets/scripts.js"></script>



**2. 컨피그 마이그레이션**  
   - 결국 컨피그는 일정한 규칙을 가진다는 점에 착안하여 신규 장비의 컨피그를 추출하고,  
     기존 컨피그와 이름만 추출해서 비교하여 마이그레이션이 꼭 필요한 설정만을 찾아보기로 했다.
   - 약 80개의 컨피그가 비교가 필요했고, 기존 컨피그의 80%가 웹필터였으므로  
     필요한 부분만 옮길 수 있었다.

**3. HA 설정 문제 해결**  
   - 포티게이트는 특이하게 HA 인터페이스가 일반 인터페이스로 인식되지 않는다.  
   - AMI는 하나의 인터페이스만 연결되어 있는데 이를 HA 인터페이스로 지정하면 원격 연결이 끊긴다.
   - 다행히 FortiGate AMI는 **고정된 SSH 비밀번호로 콘솔 연결**을 통해 접근할 수 있어 설정을 초기화하고  
     추가 인터페이스를 생성하여 장비에 연결한 후 HA 포트로 지정하였다.
   - HA가 헬스 체크를 자주 하다 보니 같은 서브넷을 사용하면 네트워크가 방해받아,  
     별도의 서브넷을 생성하고 HA 포트를 각각 연결하여 문제를 해결했다.

---

## 운영 단계

1. **웹필터 URL 추가**  
   - 어떤 서비스에 문제가 있으면 거의 cdn url 중하나가 웹필터에 의해 차단된 것이었다.
     최근에 MS 관련 60여 개의 URL이 추가되었는데,  
     장비 백업 컨피그를 받아 MS URL JSON 파일을 ChatGPT로 변환하여  
     웹필터 형식으로 만든 후 백업 컨피그에 추가하여 간단히 해결했다.

2. **포티클라이언트 SSO 연결 문제**  
   - 포티클라이언트가 지정된 시간(기본 8시간)이 지난 후 재연결 시 연결되지 않으며  
     재부팅해야만 연결이 된다.
   - 포티토큰을 이용한 내부 MFA는 문제가 없지만 외부 인증은 오류가 발생한다.  
   - 클라이언트 버전을 올리고 낮추어도 해결되지 않았다.

---

## 결론

FortiClient AMI의 하루 사용료는 약 50달러, 2중화 시 100달러로 한 달 약 3000달러에 이른다.  
기존 환경이나 보안팀 요구가 아니라면 OpenVPN이 더 적합했을 것이다.

- **대안 제안**: VPN이 필요하다면 OpenVPN을 사용하고 대부분의 리소스가 AWS 상에 있으므로  
  SG를 활용하여 접근을 제어하는 것이 더 경제적일 수 있다.
- **웹필터**는 사용자 네트워크에 **Squid를 설치**하여 제어하면 인스턴스 비용을 제외하고 무료로 활용 가능하다.

---

