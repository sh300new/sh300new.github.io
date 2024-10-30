---
title: ecs 리툴 eks 마이그레이션
date: 2023-10-29 # 최초 작성일 수동 입력
last_modified_at: 2023-10-30 # GitHub Actions로 자동 업데이트
---

# ecs 서비스 eks 마이그레이션

---

작성일: {{ page.date | date: '%Y-%m-%d' }}  
마지막 수정: {{ page.last_modified_at | date: '%Y-%m-%d' }}

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

**2. eks 생성 후 추가로 설치해줘야 하는 것들**  
k8s 1.31 버전 기준 eksctl 설치 후 자동으로 설치되지 않는 것들에 대해 추가가 필요하다
   - ebs-csi driver 설치(DB를 이용해야 하는 경우)
      'aws eks create-addon --cluster-name <cluster-name> --addon-name aws-ebs-csi-driver --region <region>'
   - 노드그룹에 IAM 권한 추가(eksctl로 생성되는 iam 권한 중 ec2:createtag 등 일부 권한이 빠져 있어 추가해 줘야함)
<link rel="stylesheet" href="/assets/styles.css">

<div class="code-container">
  <button onclick="toggleCode()" class="toggle-btn">노드그룹에 추가해줘야할 권한.json</button>
  <pre id="code-block" class="code-block">
    <code>
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ec2:CreateVolume",
                "ec2:AttachVolume",
                "ec2:DeleteVolume",
                "ec2:DescribeVolumes",
                "ec2:DescribeVolumeStatus",
                "ec2:DescribeInstances",
                "ec2:DescribeAvailabilityZones",
                "ec2:ModifyVolume",
                "ec2:CreateTags"
            ],
            "Resource": "*"
        }
    ]
}

    </code>
  </pre>
  <button onclick="copyCode()" class="copy-btn">Copy</button>
</div>

<script src="/assets/scripts.js"></script>
   - VPC를 직접 생성한 경우 k8s가 인식할 수 있도록 태그를 붙여줘야 함
   - aws-loadbalancer-controller 설치(개인적으로 헬름차트를 통해 설치하는게 편한듯)
   - 클러스터에 IAM OIDC 제공자가 연결
      'eksctl utils associate-iam-oidc-provider --region=ap-northeast-2 --cluster=staging-cluster --approve'
   - 좀전에 만든 aws-loadbalancer-controller를 위한 서비스 계정 생성 및 연결

현실적으로 이걸 완벽하게 따라하는 것도 좋지만 한쪽에 k9s로 파드 목록을 띄워놓고 빨간 애들은 d를 통해 로그를 보면서 해결하는 것이 가장 좋을 것 같다.

---

## 운영 단계

1. 

---

## 결론

---

