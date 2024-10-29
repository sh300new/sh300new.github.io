// assets/scripts.js
function toggleCode() {
  const codeBlock = document.getElementById("code-block");
  const copyBtn = document.querySelector(".copy-btn");
  if (codeBlock.style.display === "none") {
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
