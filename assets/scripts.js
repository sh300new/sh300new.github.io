// assets/scripts.js
function toggleCode() {
  const codeBlock = document.getElementById("code-block");
  const copyBtn = document.querySelector(".copy-btn");

  // 코드 블록과 복사 버튼이 초기에는 display: "none"이므로 toggle을 위해 정확히 설정합니다.
  if (codeBlock.style.display === "" || codeBlock.style.display === "none") {
    codeBlock.style.display = "block";
    copyBtn.style.display = "block";
  } else {
    codeBlock.style.display = "none";
    copyBtn.style.display = "none";
  }
}

function copyCode() {
  const codeBlock = document.getElementById("code-block").innerText;
  navigator.clipboard.writeText(codeBlock).then(() => {
    alert("Code copied to clipboard!");
  });
}
