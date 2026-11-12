// 공 창: 본체가 주소 뒤(#right, #left, #still)를 바꿔서 굴러가는 방향을 알려 준다.
function apply() {
  document.body.className = location.hash.slice(1) || "still";
}
window.addEventListener("hashchange", apply);
apply();
