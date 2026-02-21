
export function getHashRoute(){
  const h=(location.hash||"#post").replace("#","").trim();
  return h||"post";
}

export function showView(route){
  const map={
    post:"pagePost",
    book:"pageBook",
    projects:"pageProjects",
    profile:"pageProfile",
    create:"pageCreatePackage",
    settings:"pageSettings"
  };
  const id=map[route]||"pagePost";
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("show",p.id===id));
}

export function startRouter(){
  window.addEventListener("hashchange",()=>showView(getHashRoute()));
}
