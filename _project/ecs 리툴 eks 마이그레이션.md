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

<link rel="stylesheet" href="/assets/styles.css">

<div class="code-container">
  <button onclick="toggleCode()" class="toggle-btn">delete all vpc resource.sh</button>
  <pre id="code-block" class="code-block">
    <code>
VPC_ID={your-vpc-id}

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


---

## 운영 단계

1. 

---

## 결론

F
---

