function toggleCode(button) {
  // 버튼의 data-code 속성 값을 가져와서 해당 코드 블록 ID와 복사 버튼 ID를 설정합니다.
  const codeBlockId = button.getAttribute("data-code");
  const codeBlock = document.getElementById(codeBlockId);
  const copyBtn = document.querySelector(`[data-copy="${codeBlockId}"]`);

  // 코드 블록과 복사 버튼 표시를 토글합니다.
  if (codeBlock.style.display === "" || codeBlock.style.display === "none") {
    codeBlock.style.display = "block";
    copyBtn.style.display = "block";
  } else {
    codeBlock.style.display = "none";
    copyBtn.style.display = "none";
  }
}

function copyCode(button) {
  // 버튼의 data-copy 속성 값을 사용해 해당 코드 블록의 내용을 복사합니다.
  const codeBlockId = button.getAttribute("data-copy");
  const codeText = document.getElementById(codeBlockId).innerText;

  navigator.clipboard.writeText(codeText).then(() => {
    alert("Code copied to clipboard!");
  }).catch(err => {
    alert("Failed to copy code.");
  });
}
