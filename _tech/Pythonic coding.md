---
title: Pythonic coding
date: 2023-11-03
last_modified_at: 2023-10-30 # GitHub Actions로 자동 업데이트
---

# Pythonic coding

---

작성일: {{ page.date | date: '%Y-%m-%d' }}  
마지막 수정: {{ page.last_modified_at | date: '%Y-%m-%d' }}

---

## 고민

파이썬으로 코드를 짤때, 더 우아하고 간결하게 코드를 짜기 위해 필요한 문법들
일단 우리의 목적은 최대한 많은 점수를 받는 것이기 때문에, 빠르게 푸는 것이 중요하다.
그래서 처음 풀때는 코드에 대한 우아함보다는 일단 if를 적극적으로 써서 머릿속에 떠오른 로직대로 구현하는게 중요하지 않을까 싶다.
물론 이건 계속 공부하면서 바뀌겠지.

---

## zip

`zip()` 함수는 여러 개의 리스트나 튜플을 동시에 순회할 때 사용, 각 리스트의 같은 인덱스에 있는 요소를 묶어서 튜플로 반환해 준다. 이를 통해 반복문을 간결하고 가독성 좋게 만들 수 있다.
```python
names = ["Alice", "Bob", "Charlie"]
ages = [24, 30, 18]

for name, age in zip(names, ages):
    print(f"{name} is {age} years old.")
```
---

## 리스트 컴프리헨션 (List Comprehension)

리스트 컴프리헨션을 사용하면 리스트를 생성할 때 반복문과 조건문을 한 줄에 표현할 수 있어 코드가 간결해진다.
```python
squares = [x ** 2 for x in range(1, 11) if x % 2 == 0]
```
---

## list comprehension과 zip의 용례

코딩테스트를 해야 할 때면 항상 방문하는 블로그가 있는데 이 사람이 선별해 놓은 문제가 좋아서 자주 푼다.  
[코딩테스트 공부 velog](https://velog.io/@pppp0722/%EC%BD%94%EB%94%A9%ED%85%8C%EC%8A%A4%ED%8A%B8-%EB%AC%B8%EC%A0%9C-%EC%9C%A0%ED%98%95-%EC%A0%95%EB%A6%AC)

근데 이중에 프로그래머스의 문제 중 단어 변환 문제를 풀고 있었는데  
[프로그래머스 - 단어 변환](https://school.programmers.co.kr/learn/courses/30/lessons/43163)

두개의 리스트에 있는 단어를 비교하여 서로 다른 문자열이 한개만 있는 단어들을 찾는 부분을 구현해야 했다.
한번 구현해 보고 챗지피티에게 더 나은 방법이 없나 물어봤더니 아래와 같은 충격적인 코드를 줬다. 
```python
if sum(1 for a, b in zip(word, word2) if a != b) == 1:
```
컴프리헨젼 문법을 사용해, word와 word2를 비교하여 다르면 1을 리스트에 넣고 이걸 더해서 결과를 낸 후 그 값이 1이면 이라는 조건문이다.
이보다 pythonic하게 작성할 수 있을까, 나도 앞으로 잘활용해보고자 정리하였다.


---

## 리스트 pop() 메서드 활용하기

리스트에서 pop() 메서드는 마지막 요소 또는 특정 인덱스의 요소를 제거하고 그 값을 반환, 인덱스를 지정하지 않으면 마지막 요소를 제거하고, pop(0)처럼 인덱스를 지정하면 그 위치의 요소를 제거한다.
```python
queue = [1, 2, 3, 4, 5]
first = queue.pop(0)
```
--- 

## while 문에서 조건 최적화하기

while 문을 사용할때면 보통 q가 비어있거나 하는 등 초기화된 값으로 내 변수가 돌아갔을때 종료시키는 로직을 많이 쓰는데, 그래서 이때 보통 초기화가 아닌 첫 값을 넣고, 로직은 두번째 값부터 돌리는 등 소스코드가 우아하지 못하게 됐었는데, 첫 while 로직에 초기화 값일때를 or로 넣으면 된다는 것을 깨달았다.
```python
count = 5  
some_other_condition = True  
while count > 0 or some_other_condition:  
    # 코드 실행  
    print("Count:", count)  
    count -= 1  
    # some_other_condition이 참이라면 추가 작업을 수행  
```
--- 

## 삼항 연산자(조건부 표현식)

아주 간단한 if 문 후 특정 값에 적용해야 할때 한줄로 간단히 표현할 수 있는 방법, 특히 리턴에 넣으면 그 위에 코드들을 매우 간단하게 만들어 줄 수 있다.
```python
<True일 때 값> if <조건> else <False일 때 값>
```
---