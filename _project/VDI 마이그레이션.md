---
title: VDI 마이그레이션
date: 2024-10-29 # 최초 작성일 수동 입력
last_modified_at: 2023-10-30 # GitHub Actions로 자동 업데이트
---

# VDI 마이그레이션

---

작성일: {{ page.date | date: '%Y-%m-%d' }}  
마지막 수정: {{ page.last_modified_at | date: '%Y-%m-%d' }}

---

## 디자인

기존 VDI는 거대한 물리 장비를 통해 운영되고 있어 유지보수 비용이 실제 사용자들의 사용 대비 과도하게 컸다.  
보다 간편하게 사용자들에게 가상 데스크탑 환경을 제공할 수 있는 방법을 찾던 중, AWS WorkSpaces를 도입하기로 결정했다.  
보안 솔루션을 구축하는 선택지와 사용자 통제를 강화하는 선택지 중 사용자 통제를 강화하는 쪽으로 도전해보기로 했다.

---

## 구축 단계

**1. WorkSpaces 접근 제어 구성**  
   - WorkSpaces에서는 인증서 기반 접근 제어가 가능하다. 이 방식은 조금 복잡하지만 WorkSpaces에 대한 확실한 접근 제어를 제공한다.  
   - [AWS Certificate-based Authentication 가이드](https://docs.aws.amazon.com/ko_kr/workspaces/latest/adminguide/certificate-based-authentication.html)
   - 이 방식을 통해 사설 인증서를 발급받고, 클라이언트에 해당 인증서를 import해야만 WorkSpaces에 접근할 수 있다.

**2. open vpn 구축**  
   - 사용자 접근제어를 강화하기 위해 open vpn을 ami를 통해 구축, open vpn nat gw ip 대역만 workspace 접근 가능하게 구성하였다.
   - open vpn ami는 2명까지 무료로 이용할 수 있으며, 이후 추가될 때마다 1명당 과금을 하는데, 사용자가 많아질수록 저렴해짐. 비교적 안정적으로 vpn 서비스를 이용할 수 있어 메리트가 있어 보임
   - SSO 인증을 통해 구성하였는데, 인증 서비스 제공자 url만 입력하면 SAML 값 등 자동으로 채워주는 기능이 있어서 편리했고, 구축시 별다른 이슈는 없었음

**3. 사용자 통신 제어**  
   - 사용자들의 인터넷 사용을 제한할 필요가 있었다. 기존에는 FortiGate와 동일한 네트워크에 있어, FortiGate를 통해 웹 필터를 적용할 수 있었다.
   - 그러나 비용이 너무 크게 발생했고, 보안팀에서는 현재 FortiGate로 구현이 불가능한, **업무용 WorkSpaces에서는 개인 AWS 계정으로의 로그인을 차단하는 기능**을 요구했다.
   - 이에 Squid 프록시 설치를 제안했고, 흥미로워 보여 이를 수용했다.
   - 웹 필터 적용은 어려운 작업이 아니었으나 ChatGPT의 일부 부정확한 정보로 인해 시간이 걸렸는데, Squid 자체만으로는 페이로드 검사가 불가능하다는 사실을 알게 되었다.
   - Squid는 ICAP 프로토콜을 통해 외부 서버에 패킷을 전달하고 응답을 받는 것만 가능하여, ICAP 기반 서버가 필요했다. 이에 소켓 통신을 통해 ICAP 프로토콜로 패킷을 수신하고 응답을 전달하는 간단한 Python ICAP 서버를 구현해 문제를 해결했다.
   - 특이하게도 Squid 서버는 ICAP 프로토콜로 전달된 200 OK 응답을 처리하지 못하지만, 204 No Content 응답은 정상적으로 처리했다. 따라서 정상 응답을 200이 아닌 204로 처리했다.
   - 이를 통해 AWS 인증 URL 경로인 `/authentication`을 모니터링하고, 페이로드에 특정 account number가 들어가면 통신을 차단하는 기능을 구현했다.
   - 네트워크 구성을 세 개의 서브넷으로 분리하여, WorkSpaces가 위치한 서브넷에는 인터넷 라우팅을 추가하지 않고, Squid가 있는 서브넷에 NAT 게이트웨이에 대한 라우팅을 넣어 WorkSpaces에서는 Squid 프록시를 통하지 않고는 인터넷 통신이 불가능하도록 설정했다.


---

## 운영 단계

**1. yum 접근을 위한 프록시 설정 추가**
  - 운영 중 일부 유저의 요청에 의해 아마존 레포에 대한 통신 설정을 하였다. 이미 아마존쪽 url은 모두 열려 있기에 yum에 간단한 설정을 추가하는 것만으로 레포 이용이 가능해졌다.
```bash
echo -e "proxy=http://{proxy-ip}:3128\nsslverify=false" | sudo tee -a /etc/yum.conf
```
---

## 결론

Squid를 처음 사용해봤는데, 무료 오픈소스일 뿐 아니라 Python으로 간단히 ICAP 서버를 동일 서버에 구현하여 **IPS, IDS 기능을 저렴하게 구현**할 수 있었다.  
물론 프로덕션 환경에서 사용하기엔 어려움이 있겠지만, 여러 VPC에 네트워크 접근 제어가 필요할 때 Squid는 매우 유용한 옵션으로 보인다.

---
