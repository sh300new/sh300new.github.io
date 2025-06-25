---

title: Launch Template 기반 EC2 업데이트 자동화 스크립트
date: 2025-06-25
last\_modified\_at: 2025-06-25
------------------------------

# Launch Template 기반 EC2 업데이트 자동화 스크립트

작성일: {{ page.date | date: '%Y-%m-%d' }}
마지막 수정: {{ page.last\_modified\_at | date: '%Y-%m-%d' }}

---

## 디자인

Auto Scaling Group(ASG)에 연결된 EC2 인스턴스는 보안 업데이트 및 시간 동기화 설정이 수동으로 처리되고 있었으며,
Launch Template(LT)을 통한 사용자 데이터(UserData) 변경이 필요한 상황에서도
매번 수동으로 LT 버전을 만들고 이를 ASG에 반영한 후 인스턴스 Refresh까지 별도로 수행해야 했다.

이러한 반복적이고 실수 유발 가능성이 있는 작업을 자동화하기 위해,
기존 Launch Template의 설정을 복사하고 보안 패치 및 AWS NTP 설정을 추가한 후
ASG를 업데이트하고 인스턴스 리프레시까지 자동 수행하는 스크립트를 구현하였다.

---

## 구축 단계

**1. 입력 값 정의**

* AWS 프로파일 이름, 리전, 대상 ASG 이름을 상단 변수로 선언
* Launch Template ID 및 현재 사용 중인 버전은 ASG에서 자동 추출

**2. 기존 Launch Template 정보 조회**

* `describe_auto_scaling_groups`로 대상 ASG에 연결된 LT ID, 버전 추출
* `describe_launch_template_versions`를 통해 기존 사용자 데이터(UserData) 포함 전체 설정 로딩

**3. 사용자 데이터(UserData) 패치 구성**

* yum/apt를 이용한 OS 보안 패치 자동 수행
* `/etc/chrony.conf` 또는 `/etc/ntp.conf`에 AWS NTP 서버(169.254.169.123) 추가
* 기존 UserData가 존재하는 경우, 새로운 스크립트 뒤에 기존 UserData를 append
* Base64로 인코딩하여 Launch Template에 삽입

**4. Launch Template 새 버전 생성 및 Default 설정**

* 기존 필드에서 복사할 항목을 엄격하게 지정 (`ImageId`, `SecurityGroupIds` 등)
* `create_launch_template_version` 호출
* 이후 `modify_launch_template`을 통해 새 버전을 default로 설정

**5. Auto Scaling Group 갱신 및 인스턴스 리프레시**

* `update_auto_scaling_group`으로 새 버전을 적용
* `start_instance_refresh` API를 통해 무중단 배포 수행

  * 설정: `MinHealthyPercentage = 90`, `InstanceWarmup = 300`

<div class="code-container">
  <button onclick="toggleCode(this)" class="toggle-btn" data-code="code-block-1">asg_userdata_update.py</button>
  <pre id="code-block-1" class="code-block">
    <code>
#!/usr/bin/env python3
import base64
import boto3
import sys
from botocore.exceptions import ClientError

# ▼ 여기에 AWS 프로파일, 리전, ASG 이름을 변수로 지정하세요 ▼
PROFILE_NAME = "gopax-qa"
REGION_NAME = "ap-northeast-1"
ASG_NAME     = "gopax-qa-revised-ResourceStack-F72OU1UW2O9V-EC2MMTrackerToolAutoScalingGroup-9YM8O9OUFHOC"
# ▲ 여기까지 수정하면 됩니다 ▲

def get_asg_details(asg_client, asg_name):
    try:
        response = asg_client.describe_auto_scaling_groups(
            AutoScalingGroupNames=[asg_name]
        )
        groups = response.get("AutoScalingGroups", [])
        if not groups:
            print(f"[ERROR] Auto Scaling Group '{asg_name}' not found.")
            sys.exit(1)
        return groups[0]
    except ClientError as e:
        print(f"[ERROR] describe_auto_scaling_groups failed: {e}")
        sys.exit(1)

def get_launch_template_data(ec2_client, lt_id, lt_version):
    try:
        resp = ec2_client.describe_launch_template_versions(
            LaunchTemplateId=lt_id,
            Versions=[lt_version]
        )
        versions = resp.get("LaunchTemplateVersions", [])
        if not versions:
            print(f"[ERROR] Launch template version '{lt_version}' not found.")
            sys.exit(1)
        return versions[0]["LaunchTemplateData"]
    except ClientError as e:
        print(f"[ERROR] describe_launch_template_versions failed: {e}")
        sys.exit(1)

def build_user_data(old_userdata_b64):
    existing = ""
    if old_userdata_b64:
        try:
            existing = base64.b64decode(old_userdata_b64).decode("utf-8")
        except Exception:
            existing = ""
    script = """#!/bin/bash
# 1) Apply all security updates
if command -v yum >/dev/null 2>&1; then
  yum update -y
elif command -v apt-get >/dev/null 2>&1; then
  apt-get update && apt-get upgrade -y
fi

# 2) Configure NTP to AWS NTP server (169.254.169.123)
if [ -f /etc/chrony.conf ]; then
  sed -i 's/^pool /#pool /g' /etc/chrony.conf
  echo "server 169.254.169.123 prefer iburst" >> /etc/chrony.conf
  systemctl enable chronyd
  systemctl restart chronyd
elif [ -f /etc/ntp.conf ]; then
  sed -i 's/^server /#server /g' /etc/ntp.conf
  echo "server 169.254.169.123 prefer iburst" >> /etc/ntp.conf
  systemctl enable ntpd
  systemctl restart ntpd
fi

# 3) Existing userdata (if any)
"""
    combined = script + "\n" + existing
    return base64.b64encode(combined.encode("utf-8")).decode("utf-8")

def create_new_lt_version(ec2_client, lt_id, source_version, template_data):
    new_userdata = build_user_data(template_data.get("UserData"))
    allowed_keys = [
        "ImageId",
        "InstanceType",
        "KeyName",
        "SecurityGroupIds",
        "SecurityGroups",
        "IamInstanceProfile",
        "BlockDeviceMappings",
        "NetworkInterfaces",
        "Placement",
        "Monitoring",
        "EbsOptimized",
        "CpuOptions",
        "TagSpecifications"
    ]
    fields = {}
    for key in allowed_keys:
        if key in template_data:
            fields[key] = template_data[key]
    fields["UserData"] = new_userdata

    try:
        resp = ec2_client.create_launch_template_version(
            LaunchTemplateId=lt_id,
            SourceVersion=source_version,
            LaunchTemplateData=fields
        )
        version_number = resp["LaunchTemplateVersion"]["VersionNumber"]
        print(f"[INFO] Created new Launch Template version: {version_number}")
        return version_number
    except ClientError as e:
        print(f"[ERROR] create_launch_template_version failed: {e}")
        sys.exit(1)

def set_default_launch_template_version(ec2_client, lt_id, default_version):
    try:
        ec2_client.modify_launch_template(
            LaunchTemplateId=lt_id,
            DefaultVersion=str(default_version)
        )
        print(f"[INFO] Set Launch Template default version to: {default_version}")
    except ClientError as e:
        print(f"[ERROR] modify_launch_template failed: {e}")
        sys.exit(1)

def update_asg_launch_template(asg_client, asg_name, lt_id, lt_version):
    try:
        asg_client.update_auto_scaling_group(
            AutoScalingGroupName=asg_name,
            LaunchTemplate={
                "LaunchTemplateId": lt_id,
                "Version": str(lt_version)
            }
        )
        print(f"[INFO] ASG '{asg_name}' updated to use LT version {lt_version}")
    except ClientError as e:
        print(f"[ERROR] update_auto_scaling_group failed: {e}")
        sys.exit(1)

def start_instance_refresh(asg_client, asg_name, lt_id, lt_version):
    try:
        resp = asg_client.start_instance_refresh(
            AutoScalingGroupName=asg_name,
            DesiredConfiguration={
                'LaunchTemplate': {
                    'LaunchTemplateId': lt_id,
                    'Version': str(lt_version)
                }
            },
            Preferences={
                "MinHealthyPercentage": 90,
                "InstanceWarmup": 300
            }
        )
        refresh_id = resp.get("InstanceRefreshId")
        print(f"[INFO] Started instance refresh (ID: {refresh_id})")
    except ClientError as e:
        print(f"[ERROR] start_instance_refresh failed: {e}")
        sys.exit(1)

def main():
    # boto3 Session을 생성할 때 프로파일과 리전을 코드 내 변수로 넘깁니다.
    session = boto3.Session(profile_name=PROFILE_NAME, region_name=REGION_NAME)
    asg_client = session.client("autoscaling")
    ec2_client = session.client("ec2")

    # 1) ASG 상세 조회
    asg = get_asg_details(asg_client, ASG_NAME)
    lt = asg.get("LaunchTemplate")
    if not lt:
        print(f"[ERROR] ASG '{ASG_NAME}' does not use a Launch Template.")
        sys.exit(1)

    lt_id = lt["LaunchTemplateId"]
    current_version = lt["Version"]

    # 2) 현재 Launch Template 데이터 가져오기
    template_data = get_launch_template_data(ec2_client, lt_id, current_version)

    # 3) 보안 패치 + NTP 설정을 포함한 새 Launch Template 버전 생성
    new_version = create_new_lt_version(ec2_client, lt_id, current_version, template_data)

    # 4) 새 버전을 Default 버전으로 설정
    set_default_launch_template_version(ec2_client, lt_id, new_version)

    # 5) ASG가 새 버전을 사용하도록 업데이트
    update_asg_launch_template(asg_client, ASG_NAME, lt_id, new_version)

    # 6) 인스턴스 리프레시 시작
    start_instance_refresh(asg_client, ASG_NAME, lt_id, new_version)

if __name__ == "__main__":
    main()
</code> </pre> <button onclick="copyCode(this)" class="copy-btn" data-copy="code-block-1" style="display: none;">Copy</button>

</div>

---

## 운영 단계

1. **실행 예시**

   * `python3 update_asg_userdata.py` 실행 시 순차적으로 다음 작업이 진행됨:

     1. 현재 LT 정보 조회
     2. 새로운 UserData를 삽입한 LT 버전 생성
     3. Default 버전 변경
     4. ASG에 새 LT 반영
     5. 인스턴스 리프레시 수행

2. **오류 처리**

   * 각 boto3 호출에 대해 `ClientError`를 예외 처리
   * ASG 또는 LT가 존재하지 않는 경우 즉시 종료

3. **주의사항**

   * ASG가 Launch Configuration을 사용하는 경우에는 동작하지 않음
   * UserData를 수정하는 방식이므로 기존 데이터가 인코딩 오류일 경우 무시될 수 있음
   * 보안 그룹, AMI ID, EBS 설정 등 민감한 필드는 복사 대상 필드에 명시적으로 포함되어야 함

---

## 결론

이 스크립트를 통해 운영 중인 ASG 환경에서도
**간단한 Python 실행만으로 인스턴스 보안 업데이트 및 시간 동기화 구성을 자동화**할 수 있게 되었다.
모든 작업이 API를 통해 자동으로 수행되므로 수작업 대비 오류 가능성이 현저히 줄어들며,
NTP 설정을 일괄적으로 적용할 수 있어 서버 간 시간 오차 문제도 예방할 수 있다.

향후 발전 방향:

* UserData 스크립트에 로깅 또는 상태 리포팅 기능 추가
* 변경 전/후 LT diff 비교 기능 구현
* Terraform 또는 CloudFormation 기반 자동화 환경과 연동
