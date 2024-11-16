---
title: Pythonic coding
date: 2024-11-03
last_modified_at: 2023-11-07 # GitHub Actions로 자동 업데이트
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

## 리스트 pop(), 인덱싱, 슬라이싱 메서드 활용하기

리스트에서 pop() 메서드는 마지막 요소 또는 특정 인덱스의 요소를 제거하고 그 값을 반환, 인덱스를 지정하지 않으면 마지막 요소를 제거하고, pop(0)처럼 인덱스를 지정하면 그 위치의 요소를 제거한다.  
인덱싱은 순서대로 참조할 수 있는 메서드이고, -1은 마지막 값을 참조한다.  
슬라이싱은 리스트를 n배수만큼 곱하여 순회하며 참조할 수 있는 방법이고, -1을 입력하면 리스트가 역순으로 참조된다.

```python
queue = [1, 2, 3, 4, 5]
first = queue.pop(0)

# 예시 리스트
my_list = [1, 2, 3, 4, 5]

# 첫 번째 값 출력
print(my_list[0])  # 출력: 1

# 마지막 값 출력
print(my_list[-1])  # 출력: 5

# 리스트 뒤집기
reversed_list = my_list[::-1]
print(reversed_list)  # 출력: [5, 4, 3, 2, 1]
```
--- 

## range 함수 활용하기

range 함수도 리스트의 인덱싱과 슬라이싱처럼 range(end, start, -1) 이런 식으로 활용 가능하다.

```python
#다만 리스트 인덱싱과 다른 점은 가운데 0을 비워둘 수 없다는 것
print(list(range(4, 0, -1)))  # [5, 4, 3, 2] 
```

range 객체는 보통 list로 쓰기 위함이지만, 그냥 range() 객체를 호출하면 range 객체가 출력된다. 
그 이유는 100만의 range를 호출했을 때 바로 list를 생성하면 메모리 사용을 갑자기 많이 해야 하기 때문에  
lazy evaluation을 활용하여 호출될때마다 값을 생성하는 것이다. 만약 range를 그냥 바로 list로 쓰고 싶다면 list로 타입변환 해주면 된다.

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

## itertools

코딩 테스트를 보다보면 조합을 생각해야할 때가 많은데 그럴 때마다 멘붕만 했지 제대로 준비를 안했다.
그래서 시험이 끝나고 찾아보니 아주 놀라운 내장 함수가 있었다. 크게 3가지 용례가 있는데
전체 가능한 모든 조합의 순열을 출력하는 것, 조합을 출력하는 것, 여러 리스트의 조합을 생성하는 것
어떻게 그냥 물어봤는데 딱 이렇게 쓸만한 애들만 알려줄까...
```python
import itertools

# 1부터 4까지 숫자의 모든 순열
print(list(itertools.permutations([1, 2, 3, 4])))
# 결과: [(1, 2, 3, 4), (1, 2, 4, 3), (1, 3, 2, 4), (1, 3, 4, 2), (1, 4, 2, 3), 
#       (1, 4, 3, 2), (2, 1, 3, 4), (2, 1, 4, 3), (2, 3, 1, 4), (2, 3, 4, 1), 
#       (2, 4, 1, 3), (2, 4, 3, 1), (3, 1, 2, 4), (3, 1, 4, 2), (3, 2, 1, 4), 
#       (3, 2, 4, 1), (3, 4, 1, 2), (3, 4, 2, 1), (4, 1, 2, 3), (4, 1, 3, 2), 
#       (4, 2, 1, 3), (4, 2, 3, 1), (4, 3, 1, 2), (4, 3, 2, 1)]

# 1부터 4까지 숫자의 길이 2의 조합
print(list(itertools.combinations([1, 2, 3, 4], 2)))
# 결과: [(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)]

# 두 리스트의 카테시안 곱
print(list(itertools.product([1, 2], ['A', 'B'])))
# 결과: [(1, 'A'), (1, 'B'), (2, 'A'), (2, 'B')]
```
---
## defaultdict

우리의 친구 collections 모듈의 defaultdict라는 클래스가 있다. 예전에 try: dict[a] += 1 except: dict[a] == 1  
이런식으로 표현해야 했던 dict 자료형을 쓰기 편하게 해주는 클래스인데, 만약 key가 해당 dict에 없다면 추가한 후 해당 작업을 수행한다.  
다만 주의사항은 한번 선언된 디폴트딕트 객체는 계속 디폴트 딕트기에 연산이 끝난 후 dict로 변환해 주는 것이 안전하다.
```python
from collections import defaultdict
dicta = defaultdict(int)
dataa[1] += 1 
dataa[2] += 1

normal_dicta = dict(dicta)
```
---
## set 자료형

python에는 dict와 비슷한 자료형이 있는 set이다. value를 가지지 않는 dict라고 보면 된다.
근데 이 녀석이 아주 재미있는게, dict와 같이 hash 방식으로 데이터를 저장하기 때문에 시간 복잡도도 inset, find 모두 O(1)이고
중복되는 데이터도 자동으로 삭제해주기 때문에 코딩 테스트에서 매우 유용한 자료형이다.
기본적으로 add, remove, update(list를 넣을때) 등을 사용하고 추가로 여러 기능들을 제공한다.
```python
# 1. 집합 연산
a = {1, 2, 3}
b = {3, 4, 5}
c = {5, 6}

# 합집합
print(a | b)  # {1, 2, 3, 4, 5}
print(a.union(b))  # {1, 2, 3, 4, 5}

# 교집합
print(a & b)  # {3}
print(a.intersection(b))  # {3}

# 차집합
print(a - b)  # {1, 2}
print(a.difference(b))  # {1, 2}

# 대칭차집합
print(a ^ b)  # {1, 2, 4, 5}
print(a.symmetric_difference(b))  # {1, 2, 4, 5}

# 2. 집합 비교
# 부분집합 확인
print(a.issubset(b))  # False
print({1, 2}.issubset({1, 2, 3, 4}))  # True

# 상위집합 확인
print(b.issuperset(a))  # False

# 교집합 여부 확인
print(a.isdisjoint(c))  # True

# 3. 원소 삭제
# remove
a = {1, 2, 3}
a.remove(2)  # {1, 3}
print(a)
# a.remove(4)  # KeyError 발생

# discard
a.discard(4)  # 에러 없음

# pop
removed_item = a.pop()
print(removed_item)  # 1 또는 3
print(a)  # 남은 원소

# clear
a.clear()
print(a)  # set()

# 4. 복사
# copy
a = {1, 2, 3}
b = a.copy()
print(b)  # {1, 2, 3}

# 5. 기타 활용
# 길이 확인
print(len(a))  # 3

# 존재 여부 확인
print(2 in a)  # True
print(4 in a)  # False

# 이터레이션
for item in a:
    print(item)

# 활용 예제: 중복 제거
lst = [1, 2, 2, 3, 4, 4, 5]
unique_set = set(lst)
print(unique_set)  # {1, 2, 3, 4, 5}

# 응용: 집합을 활용한 문제 해결
list1 = [1, 2, 3, 4]
list2 = [3, 4, 5, 6]

# 교집합 활용: 두 리스트의 공통 원소
common = set(list1) & set(list2)
print(common)  # {3, 4}

# 대칭차집합 활용: 서로 다른 원소 찾기
diff = set(list1) ^ set(list2)
print(diff)  # {1, 2, 5, 6}
```