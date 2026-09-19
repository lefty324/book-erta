/* 人物关系图谱 · 通用渲染引擎
 * 依赖：全局 BOOK_DATA 对象（由 books/xxx.js 提供）
 * 字段：title, groups, chapters, defaultChapter, characters, relations, events, verses(可选)
 */
(function(){
"use strict";

// --- 从 BOOK_DATA 读取 ---
var GC = BOOK_DATA.groups;
var CN = BOOK_DATA.chapters;
var AC = BOOK_DATA.characters;
var AR = BOOK_DATA.relations;
var AE = BOOK_DATA.events;
var JC = BOOK_DATA.verses || {};

// --- 预计算：每个角色出现在哪些章节 ---
var _chApp={};  // id → {chapterNum: true, ...}
AC.forEach(function(c){if(!_chApp[c.id])_chApp[c.id]={};_chApp[c.id][c.c]=1;});
Object.keys(AE).forEach(function(id){if(!_chApp[id])_chApp[id]={};AE[id].forEach(function(ev){_chApp[id][ev.c]=1;});});
AR.forEach(function(r){if(!_chApp[r.f])_chApp[r.f]={};if(!_chApp[r.t])_chApp[r.t]={};_chApp[r.f][r.c]=1;_chApp[r.t][r.c]=1;});
var _single={};  // id → chapterNum (只出现在1个章节的角色)
Object.keys(_chApp).forEach(function(id){var ks=Object.keys(_chApp[id]);if(ks.length===1)_single[id]=parseInt(ks[0]);});

// --- 全局状态 ---
var W,H,cv,cx,nodes=[],edges=[],nm={},pan={x:0,y:0},ps=null,sc=1,hn=null,sn=null;
var cc = BOOK_DATA.defaultChapter || CN.length-1;
var settled=false,dragDist=0,mdPos=null;

// --- 设置标题 ---
document.title = BOOK_DATA.title;
document.getElementById("bookTitle").textContent = BOOK_DATA.title;

// --- 移动端判断 ---
function isMobile(){return window.innerWidth<=600;}
function isTablet(){return window.innerWidth>600&&window.innerWidth<=1024;}

// --- 侧边栏开关 ---
function openSidebar(){
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebarBd").classList.add("show");
}
function closeSidebar(){
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarBd").classList.remove("show");
}

// --- 初始化 ---
function init(){
  cv=document.getElementById("c");cx=cv.getContext("2d");
  rsz();window.addEventListener("resize",function(){rsz();settled=false;lay();});
  var lg=document.getElementById("lg"),lgSeen={};
  Object.keys(GC).forEach(function(g){if(lgSeen[g])return;lgSeen[g]=1;
    var s=document.createElement("span");s.className="li";
    s.innerHTML='<span class="ld" style="background:'+GC[g]+'"></span>'+g;lg.appendChild(s);});
  buildSidebar();

  // --- 汉堡按钮 & 侧边栏 ---
  document.getElementById("menuBtn").addEventListener("click",function(){
    var sb=document.getElementById("sidebar");
    if(sb.classList.contains("open"))closeSidebar();else openSidebar();
  });
  document.getElementById("sidebarBd").addEventListener("click",closeSidebar);

  // --- 抽屉遮罩 ---
  document.getElementById("drawerBd").addEventListener("click",function(){
    sn=null;hn=null;hideDrawer();draw();
  });
  cv.addEventListener("mousedown",md);cv.addEventListener("mousemove",mm);
  cv.addEventListener("mouseup",mu);cv.addEventListener("mouseleave",function(){hn=null;draw();});
  cv.addEventListener("wheel",mw,{passive:false});
  cv.addEventListener("touchstart",ts,{passive:false});cv.addEventListener("touchmove",tv,{passive:false});
  cv.addEventListener("touchend",te);

  // --- minimap drag ---
  var mmDrag=false;
  var mc2=document.getElementById("mm");
  function mmWorld(e){
    var rect=mc2.getBoundingClientRect();
    var mx2=e.clientX-rect.left,my2=e.clientY-rect.top,mw2=180,mh2=120;
    if(nodes.length===0)return;
    var x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
    nodes.forEach(function(nd){var r=nr(nd)+15;
      if(nd.x-r<x1)x1=nd.x-r;if(nd.y-r<y1)y1=nd.y-r;
      if(nd.x+r>x2)x2=nd.x+r;if(nd.y+r>y2)y2=nd.y+r;});
    var pw=x2-x1||1,ph=y2-y1||1;
    var s=Math.min((mw2-10)/pw,(mh2-10)/ph);
    var ox=(mw2-pw*s)/2-x1*s,oy=(mh2-ph*s)/2-y1*s;
    var wx=(mx2-ox)/s,wy=(my2-oy)/s;
    pan.x=W/2-wx*sc;pan.y=H/2-wy*sc;
    draw();
  }
  mc2.addEventListener("mousedown",function(e){e.preventDefault();e.stopPropagation();mmDrag=true;mmWorld(e);});
  document.addEventListener("mousemove",function(e){if(mmDrag){e.preventDefault();mmWorld(e);}});
  document.addEventListener("mouseup",function(){mmDrag=false;});
  function mmTouch(e){return{clientX:e.touches[0].clientX,clientY:e.touches[0].clientY};}
  mc2.addEventListener("touchstart",function(e){e.preventDefault();e.stopPropagation();mmDrag=true;mmWorld(mmTouch(e));},{passive:false});
  mc2.addEventListener("touchmove",function(e){if(mmDrag){e.preventDefault();e.stopPropagation();mmWorld(mmTouch(e));}},{passive:false});
  mc2.addEventListener("touchend",function(e){e.stopPropagation();mmDrag=false;});

  // --- search ---
  var srchInput=document.getElementById("srch"),srchDrop=document.getElementById("srchDrop");
  srchInput.addEventListener("input",function(){
    var q=srchInput.value.trim().toLowerCase();
    if(!q){srchDrop.style.display="none";return;}
    var hits=AC.filter(function(c){return c.c<=cc&&(!(_single[c.id]!==undefined&&_single[c.id]!==cc))&&c.n.toLowerCase().indexOf(q)>=0;}).slice(0,8);
    if(hits.length===0){srchDrop.style.display="none";return;}
    srchDrop.innerHTML=hits.map(function(c){
      return'<div class="srch-item" data-id="'+c.id+'" style="padding:6px 12px;cursor:pointer;font-size:12px;color:#4a4a5a;border-bottom:1px solid #e0e0e8;">'
        +'<span style="color:'+GC[c.g]+';margin-right:6px;">\u25CF</span>'+c.n+'<span style="color:#707090;font-size:10px;margin-left:6px;">'+c.g+'</span></div>';
    }).join("");
    srchDrop.style.display="block";
    srchDrop.querySelectorAll(".srch-item").forEach(function(el){
      el.addEventListener("mouseenter",function(){el.style.background="#f0f0f6";});
      el.addEventListener("mouseleave",function(){el.style.background="transparent";});
      el.addEventListener("click",function(){
        var nid=el.getAttribute("data-id"),nd=nm[nid];
        if(nd){
          sn=nd;hn=nd;
          pan.x=W/2-nd.x*sc;pan.y=H/2-nd.y*sc;
          showDrawer(nd);draw();
        }
        srchDrop.style.display="none";srchInput.value="";
      });
    });
  });
  srchInput.addEventListener("keydown",function(e){
    if(e.key==="Escape"){srchDrop.style.display="none";srchInput.blur();}
    if(e.key==="Enter"){var first=srchDrop.querySelector(".srch-item");if(first)first.click();}
  });
  document.addEventListener("click",function(e){
    if(!srchInput.contains(e.target)&&!srchDrop.contains(e.target))srchDrop.style.display="none";
  });
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"){if(sn){sn=null;hn=null;hideDrawer();draw();}}
  });
  bld();lay();
}

// --- Sidebar ---
function buildSidebar(){
  var sb=document.getElementById("sidebar");
  sb.innerHTML="";
  for(var i=1;i<CN.length;i++){
    (function(ch){
      var d=document.createElement("div");
      d.className="ch-item"+(ch===cc?" active":"");
      d.innerHTML='<div class="ch-num">'+CN[ch][0]+'</div><div class="ch-title">'+CN[ch][1]+'</div>';
      d.addEventListener("click",function(){
        if(cc===ch)return;
        cc=ch;
        sb.querySelectorAll(".ch-item").forEach(function(el,idx){el.className="ch-item"+(idx+1===cc?" active":"");});
        settled=false;bld();lay();
        if(sn){
          if(nm[sn.id]){sn=nm[sn.id];hn=sn;showDrawer(sn);}
          else{sn=null;hn=null;hideDrawer();}
        }
        if(isMobile()||isTablet())closeSidebar();
      });
      sb.appendChild(d);
    })(i);
  }
}

// --- Resize ---
function rsz(){
  var wr=document.getElementById("cw");W=wr.clientWidth;H=wr.clientHeight;
  var d=window.devicePixelRatio||1;cv.width=W*d;cv.height=H*d;
  cv.style.width=W+"px";cv.style.height=H+"px";cx.setTransform(d,0,0,d,0,0);
}

// --- Build graph data ---
function bld(){
  // 保存旧位置
  var oldPos={};
  nodes.forEach(function(nd){oldPos[nd.id]={x:nd.x,y:nd.y};});
  nodes=[];edges=[];nm={};var vi={};
  AC.forEach(function(c){if(c.c>cc)return;
    if(_single[c.id]!==undefined&&_single[c.id]!==cc)return;
    vi[c.id]=1;
    var px,py;
    if(oldPos[c.id]){px=oldPos[c.id].x;py=oldPos[c.id].y;}
    else{px=W/2+(Math.random()-.5)*W*.4;py=H/2+(Math.random()-.5)*H*.4;}
    var nd={id:c.id,n:c.n,g:c.g,ch:c.c,x:px,y:py,vx:0,vy:0,cn:0};
    nodes.push(nd);nm[c.id]=nd;});
  AR.forEach(function(r){if(r.c>cc||!vi[r.f]||!vi[r.t])return;
    edges.push({f:r.f,t:r.t,l:r.l});if(nm[r.f])nm[r.f].cn++;if(nm[r.t])nm[r.t].cn++;});
  document.getElementById("st").textContent=CN[cc][0]+"\u00a0\u00b7\u00a0"+nodes.length+" \u4eba \u00b7 "+edges.length+" \u6761\u5173\u7CFB";
}

// --- Node radius ---
function nr(nd){return Math.max(6,Math.min(22,5+nd.cn*1.8));}

// --- Force layout ---
function lay(){
  // 文字宽度估算(用于重叠检测)
  function textW(nd){return nd.n.length*14+10;}
  for(var iter=0;iter<350;iter++){
    for(var i=0;i<nodes.length;i++){
      for(var j=i+1;j<nodes.length;j++){
        var dx=nodes[j].x-nodes[i].x,dy=nodes[j].y-nodes[i].y;
        var d2=dx*dx+dy*dy;if(d2<1)d2=1;
        var f=28000/d2;var dd=Math.sqrt(d2);
        var fx=dx/dd*f,fy=dy/dd*f;
        nodes[i].vx-=fx;nodes[i].vy-=fy;nodes[j].vx+=fx;nodes[j].vy+=fy;
      }
    }
    edges.forEach(function(e){
      var a=nm[e.f],b=nm[e.t];if(!a||!b)return;
      var dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy);if(d<1)d=1;
      var f=(d-200)*0.01;var fx=dx/d*f,fy=dy/d*f;
      a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;
    });
    var cex=W/2,cey=H/2;
    nodes.forEach(function(nd){
      nd.vx+=(cex-nd.x)*0.0008;nd.vy+=(cey-nd.y)*0.0008;
      nd.vx*=0.78;nd.vy*=0.78;nd.x+=nd.vx;nd.y+=nd.vy;
    });
  }
  // 重叠消除：考虑节点圆+文字标签的实际占位
  for(var pass=0;pass<60;pass++){
    var moved=false;
    for(var i=0;i<nodes.length;i++){
      for(var j=i+1;j<nodes.length;j++){
        var a=nodes[i],b=nodes[j];
        var ra=nr(a),rb=nr(b);
        // 用较大的占位半径：圆半径或文字半宽，取较大者，加间距
        var sa=Math.max(ra,textW(a)/2)+12;
        var sb=Math.max(rb,textW(b)/2)+12;
        var dx=b.x-a.x,dy=b.y-a.y;
        var d=Math.sqrt(dx*dx+dy*dy);if(d<1){dx=1;dy=0;d=1;}
        var minD=sa+sb;
        if(d<minD){
          var push=(minD-d)/2*0.5;
          var ux=dx/d,uy=dy/d;
          a.x-=ux*push;a.y-=uy*push;
          b.x+=ux*push;b.y+=uy*push;
          moved=true;
        }
      }
    }
    if(!moved)break;
  }
  // 离群节点回拉：距离质心超过平均距离2.5倍的节点拉向质心
  if(nodes.length>3){
    var cx2=0,cy2=0;
    nodes.forEach(function(nd){cx2+=nd.x;cy2+=nd.y;});
    cx2/=nodes.length;cy2/=nodes.length;
    var avgD=0;
    nodes.forEach(function(nd){avgD+=Math.sqrt((nd.x-cx2)*(nd.x-cx2)+(nd.y-cy2)*(nd.y-cy2));});
    avgD/=nodes.length;
    var thresh=avgD*2.5;
    nodes.forEach(function(nd){
      var dx=nd.x-cx2,dy=nd.y-cy2,d=Math.sqrt(dx*dx+dy*dy);
      if(d>thresh&&d>1){
        var pull=0.6;
        nd.x=cx2+dx/d*thresh*pull+dx/d*(1-pull)*d;
        nd.y=cy2+dy/d*thresh*pull+dy/d*(1-pull)*d;
      }
    });
  }
  settled=true;autoFit();draw();drawMini();
}

function autoFit(){
  if(nodes.length===0)return;
  var minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  nodes.forEach(function(nd){
    var r=nr(nd)+20;
    if(nd.x-r<minx)minx=nd.x-r;if(nd.y-r<miny)miny=nd.y-r;
    if(nd.x+r>maxx)maxx=nd.x+r;if(nd.y+r>maxy)maxy=nd.y+r;
  });
  var pw=maxx-minx,ph=maxy-miny;
  var sx=W/pw,sy=H/ph;
  sc=Math.min(sx,sy)*0.9;if(sc>2)sc=2;if(sc<0.2)sc=0.2;
  var cx2=(minx+maxx)/2,cy2=(miny+maxy)/2;
  pan.x=W/2-cx2*sc;pan.y=H/2-cy2*sc;
}

function s2w(sx,sy){return{x:(sx-pan.x)/sc,y:(sy-pan.y)/sc};}

function fn(sx,sy){
  var w=s2w(sx,sy);
  for(var i=nodes.length-1;i>=0;i--){
    var nd=nodes[i],r=nr(nd)+4,dx=w.x-nd.x,dy=w.y-nd.y;
    if(dx*dx+dy*dy<r*r)return nd;
  }return null;
}

// --- Edge curve avoidance ---
function edgeCtrl(a,b,eid){
  var mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
  var dx=b.x-a.x,dy=b.y-a.y,len=Math.sqrt(dx*dx+dy*dy);
  if(len<1)return null;
  var px=-dy/len,py=dx/len;
  var dominated=false,side=0;
  for(var i=0;i<nodes.length;i++){
    var nd=nodes[i];
    if(nd.id===a.id||nd.id===b.id)continue;
    var ax=nd.x-a.x,ay=nd.y-a.y;
    var t=(ax*dx+ay*dy)/(len*len);
    if(t<0.1||t>0.9)continue;
    var projx=a.x+t*dx,projy=a.y+t*dy;
    var dist=Math.sqrt((nd.x-projx)*(nd.x-projx)+(nd.y-projy)*(nd.y-projy));
    var r=nr(nd)+14;
    if(dist<r){dominated=true;var cross=ax*py-ay*px;side+=cross>0?1:-1;}
  }
  if(!dominated)return null;
  var curveDir=side>=0?-1:1;
  var offset=Math.max(35,len*0.2);
  return{x:mx+px*curveDir*offset,y:my+py*curveDir*offset};
}

function curveMid(a,b,cp){
  if(!cp)return{x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  var t=0.5,t1=1-t;
  return{x:t1*t1*a.x+2*t1*t*cp.x+t*t*b.x,y:t1*t1*a.y+2*t1*t*cp.y+t*t*b.y};
}

// --- Draw ---
function draw(){
  cx.clearRect(0,0,W,H);cx.save();cx.translate(pan.x,pan.y);cx.scale(sc,sc);
  var focus=sn||hn;
  var connSet=null;
  if(focus){
    connSet={};connSet[focus.id]=1;
    edges.forEach(function(e){
      if(e.f===focus.id)connSet[e.t]=1;
      if(e.t===focus.id)connSet[e.f]=1;
    });
  }

  // Pass 1: edge lines
  var edgeInfo=[];
  edges.forEach(function(e,i){
    var a=nm[e.f],b=nm[e.t];if(!a||!b)return;
    var hi=focus&&(focus.id===e.f||focus.id===e.t);
    var dimmed=focus&&!hi;
    var cp=edgeCtrl(a,b,i);var mid=curveMid(a,b,cp);
    edgeInfo[i]={cp:cp,mid:mid,hi:hi,dimmed:dimmed};
    cx.beginPath();cx.moveTo(a.x,a.y);
    if(cp)cx.quadraticCurveTo(cp.x,cp.y,b.x,b.y);else cx.lineTo(b.x,b.y);
    cx.strokeStyle=hi?"rgba(233,69,96,0.6)":dimmed?"rgba(180,180,200,0.12)":"rgba(160,160,190,0.3)";
    cx.lineWidth=hi?2.5:1;cx.stroke();
  });

  // Pass 2: edge labels
  cx.font="9px PingFang SC,Microsoft YaHei,sans-serif";
  edges.forEach(function(e,i){
    var info=edgeInfo[i];if(!info)return;
    if(info.dimmed)return;
    var mid=info.mid,hi=info.hi;
    var tw=cx.measureText(e.l).width;var pad=3;
    cx.fillStyle="rgba(245,245,248,0.9)";
    cx.fillRect(mid.x-tw/2-pad,mid.y-9-pad,tw+pad*2,12+pad*2);
    cx.fillStyle=hi?"#3a3a4a":"rgba(120,120,150,0.7)";
    cx.textAlign="center";cx.fillText(e.l,mid.x,mid.y);
  });

  // Pass 3: nodes
  nodes.forEach(function(nd){
    var r=nr(nd),col=GC[nd.g]||"#adb5bd";
    var isFocus=focus&&focus.id===nd.id;
    var isConn=connSet&&connSet[nd.id];
    var dimmed=focus&&!isConn;
    var alpha=dimmed?0.2:1;
    var isNew=cc>1&&nd.ch===cc;
    if(isFocus){cx.beginPath();cx.arc(nd.x,nd.y,r+8,0,Math.PI*2);cx.fillStyle="rgba(233,69,96,0.18)";cx.fill();}
    if(isNew&&!dimmed){
      cx.save();cx.globalAlpha=alpha*0.35;
      cx.beginPath();cx.arc(nd.x,nd.y,r+6,0,Math.PI*2);
      cx.fillStyle="#f9c74f";cx.fill();cx.restore();
    }
    cx.globalAlpha=alpha;
    var dr=isFocus?4:0;
    if(isFocus){
      cx.save();cx.shadowColor="rgba(0,0,0,0.25)";cx.shadowBlur=12;cx.shadowOffsetX=0;cx.shadowOffsetY=2;
      cx.beginPath();cx.arc(nd.x,nd.y,r+dr,0,Math.PI*2);cx.fillStyle=col;cx.fill();
      cx.restore();
      cx.beginPath();cx.arc(nd.x,nd.y,r+dr,0,Math.PI*2);
      cx.strokeStyle=col;cx.lineWidth=3;cx.stroke();
    }else{
      cx.beginPath();cx.arc(nd.x,nd.y,r,0,Math.PI*2);cx.fillStyle=col;cx.fill();
      cx.strokeStyle=isNew?"#f9c74f":col;cx.lineWidth=isNew?3:2;cx.stroke();
    }
    if(isNew&&!dimmed){
      cx.setLineDash([3,3]);cx.beginPath();cx.arc(nd.x,nd.y,r+4,0,Math.PI*2);
      cx.strokeStyle="#f9c74f";cx.lineWidth=1;cx.stroke();cx.setLineDash([]);
    }
    cx.globalAlpha=1;
  });

  // Pass 4: labels
  nodes.forEach(function(nd){
    var r=nr(nd),col=GC[nd.g]||"#adb5bd";
    var isFocus=focus&&focus.id===nd.id;
    var isConn=connSet&&connSet[nd.id];
    var dimmed=focus&&!isConn;
    var alpha=dimmed?0.2:1;
    var isNew=cc>1&&nd.ch===cc;
    var dr=isFocus?4:0;
    cx.globalAlpha=alpha;
    cx.font=(isFocus?"bold ":"")+"11px PingFang SC,Microsoft YaHei,sans-serif";
    var label=nd.n+(isNew?" \u2605":"");
    var tw=cx.measureText(label).width;var pad=2;
    cx.fillStyle="rgba(245,245,248,0.85)";
    cx.fillRect(nd.x-tw/2-pad,nd.y+nr(nd)+dr+3,tw+pad*2,14);
    cx.fillStyle=isFocus?"#2d2d3a":isNew?"#b8860b":isConn?"#3a3a4a":"#6b6b7b";
    cx.textAlign="center";cx.fillText(label,nd.x,nd.y+nr(nd)+dr+13);
    cx.globalAlpha=1;
  });

  cx.restore();drawMini();
}

// --- Minimap ---
function drawMini(){
  var mc=document.getElementById("mm");
  if(!mc||mc.offsetParent===null)return; // 手机端隐藏时跳过
  var mx=mc.getContext("2d"),mw=180,mh=120;
  mc.width=mw;mc.height=mh;
  mx.fillStyle="rgba(255,255,255,0.95)";mx.fillRect(0,0,mw,mh);
  if(nodes.length===0)return;
  var x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
  nodes.forEach(function(nd){var r=nr(nd)+15;
    if(nd.x-r<x1)x1=nd.x-r;if(nd.y-r<y1)y1=nd.y-r;
    if(nd.x+r>x2)x2=nd.x+r;if(nd.y+r>y2)y2=nd.y+r;});
  var pw=x2-x1||1,ph=y2-y1||1;
  var s=Math.min((mw-10)/pw,(mh-10)/ph);
  var ox=(mw-pw*s)/2-x1*s,oy=(mh-ph*s)/2-y1*s;
  edges.forEach(function(e){
    var a=nm[e.f],b=nm[e.t];if(!a||!b)return;
    mx.beginPath();mx.moveTo(a.x*s+ox,a.y*s+oy);mx.lineTo(b.x*s+ox,b.y*s+oy);
    mx.strokeStyle="rgba(160,160,190,0.35)";mx.lineWidth=0.5;mx.stroke();
  });
  nodes.forEach(function(nd){
    mx.beginPath();mx.arc(nd.x*s+ox,nd.y*s+oy,2,0,Math.PI*2);
    mx.fillStyle=GC[nd.g]||"#adb5bd";mx.fill();
  });
  var vx1=(-pan.x)/sc,vy1=(-pan.y)/sc,vx2=(W-pan.x)/sc,vy2=(H-pan.y)/sc;
  mx.strokeStyle="#e94560";mx.lineWidth=1.5;
  mx.strokeRect(vx1*s+ox,vy1*s+oy,(vx2-vx1)*s,(vy2-vy1)*s);
}

// --- Mouse input ---
function md(e){
  mdPos={x:e.clientX,y:e.clientY};dragDist=0;
  ps={x:e.clientX-pan.x,y:e.clientY-pan.y};
}
function mm(e){var r=cv.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top;
  if(ps){
    if(mdPos){dragDist+=Math.abs(e.clientX-mdPos.x)+Math.abs(e.clientY-mdPos.y);mdPos={x:e.clientX,y:e.clientY};}
    pan.x=e.clientX-ps.x;pan.y=e.clientY-ps.y;draw();
  }else{
    var nd=fn(sx,sy);
    var cw=document.getElementById("cw");
    if(nd){cw.classList.add("nd-hover");}else{cw.classList.remove("nd-hover");}
    if(nd!==hn){hn=nd;draw();}
  }
}
function mu(e){
  var wasClick=dragDist<5;ps=null;mdPos=null;
  if(wasClick){
    var r=cv.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top;
    var nd=fn(sx,sy);
    if(nd){sn=(sn&&sn.id===nd.id)?null:nd;hn=nd;if(sn)showDrawer(sn);else hideDrawer();}
    else{sn=null;hn=null;hideDrawer();}
    draw();
  }
}
function mw(e){e.preventDefault();var r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  var d=e.deltaY>0?0.9:1.1,ns=Math.max(0.15,Math.min(4,sc*d));
  pan.x=mx-(mx-pan.x)*(ns/sc);pan.y=my-(my-pan.y)*(ns/sc);sc=ns;draw();
}

// --- Touch input ---
var tid=null,tStart=null,pinchDist0=null;
function ts(e){
  if(e.touches.length===2){
    e.preventDefault();ps=null;tid=null;tStart=null;
    var dx=e.touches[0].clientX-e.touches[1].clientX;
    var dy=e.touches[0].clientY-e.touches[1].clientY;
    pinchDist0=Math.sqrt(dx*dx+dy*dy);return;
  }
  if(e.touches.length===1){
    e.preventDefault();var t=e.touches[0];
    tStart={x:t.clientX,y:t.clientY,time:Date.now()};
    ps={x:t.clientX-pan.x,y:t.clientY-pan.y};tid=t.identifier;pinchDist0=null;
  }
}
function tv(e){
  e.preventDefault();
  if(e.touches.length===2&&pinchDist0!==null){
    var dx=e.touches[0].clientX-e.touches[1].clientX;
    var dy=e.touches[0].clientY-e.touches[1].clientY;
    var dist=Math.sqrt(dx*dx+dy*dy);
    var ratio=dist/pinchDist0;
    var cx2=(e.touches[0].clientX+e.touches[1].clientX)/2;
    var cy2=(e.touches[0].clientY+e.touches[1].clientY)/2;
    var r=cv.getBoundingClientRect();
    var mx=cx2-r.left,my=cy2-r.top;
    var ns=Math.max(0.15,Math.min(4,sc*ratio));
    pan.x=mx-(mx-pan.x)*(ns/sc);pan.y=my-(my-pan.y)*(ns/sc);sc=ns;
    pinchDist0=dist;draw();return;
  }
  for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];
    if(t.identifier!==tid)continue;
    if(ps){pan.x=t.clientX-ps.x;pan.y=t.clientY-ps.y;draw();}
  }
}
function te(e){
  if(tStart&&e.changedTouches.length>0){
    var t=e.changedTouches[0];
    var dx=t.clientX-tStart.x,dy=t.clientY-tStart.y;
    var dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<10&&Date.now()-tStart.time<300){
      var r=cv.getBoundingClientRect();
      var sx=tStart.x-r.left,sy=tStart.y-r.top;
      var nd=fn(sx,sy);
      if(nd){sn=(sn&&sn.id===nd.id)?null:nd;hn=nd;
        if(sn)showDrawer(sn);else hideDrawer();
      }else{sn=null;hn=null;hideDrawer();}
      draw();
    }
  }
  ps=null;tid=null;tStart=null;pinchDist0=null;
}

// --- Drawer ---
function showDrawer(nd){
  var dr=document.getElementById("drawer");
  var rels=AR.filter(function(r){return r.c<=cc&&(r.f===nd.id||r.t===nd.id);});
  var ls=rels.map(function(r){var oi=r.f===nd.id?r.t:r.f;var o=nm[oi];
    return'<div class="d-rel">\u00b7 '+r.l+' \u2192 <span style="color:'+(o?GC[o.g]||'#7a828a':'#7a828a')+';margin-right:3px;">\u25CF</span>'+(o?o.n:oi)+'</div>';}).join("");
  var evts=AE[nd.id];
  var es="";
  if(evts){
    var filtered=evts.filter(function(ev){return ev.c<=cc;});
    if(filtered.length>0){
      es='<div class="d-section"><div class="d-section-title">\u2727 \u5173\u952E\u4E8B\u4EF6</div>';
      es+=filtered.map(function(ev){return'<div class="d-evt">\u25B8 '+CN[ev.c][0]+'\uff1a'+ev.t+'</div>';}).join("");
      es+='</div>';
    }
  }
  var jc=JC[nd.id];
  var js="";
  if(jc&&jc.c<=cc){
    js='<div class="d-section"><div class="d-section-title">\u270D \u5224\u8BCD\uff08'+jc.t+'\uff09</div>';
    js+='<div class="d-verse">'+jc.v.replace(/\n/g,'<br>')+'</div></div>';
  }
  // 手机版保留拖拽条
  var handleHtml=isMobile()?'<div class="drawer-handle"></div>':'';
  dr.innerHTML=handleHtml+'<div class="d-header"><span class="d-close" id="d-close">\u2715</span>'
    +'<h3>'+nd.n+'</h3>'
    +'<span class="tg">'+nd.g+'</span>'
    +'<div style="font-size:13px;color:#9b9bab;margin-bottom:0;">\u9996\u6B21\u51FA\u573A\uff1a'+CN[nd.ch][0]+'</div></div>'
    +js
    +(ls?'<div class="d-section"><div class="d-section-title">\u2728 \u4EBA\u7269\u5173\u7CFB</div>'+ls+'</div>':'<div style="color:#9b9bab">\u6682\u65E0\u5173\u7CFB</div>')
    +es;
  dr.classList.add("open");dr.scrollTop=0;
  if(isMobile())document.getElementById("drawerBd").classList.add("show");
  document.getElementById("d-close").addEventListener("click",function(){sn=null;hideDrawer();draw();});
  // 手机版下滑关闭
  if(isMobile())initDrawerSwipe(dr);
}
function hideDrawer(){
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawerBd").classList.remove("show");
}

// --- 底部sheet下滑关闭 ---
var _drawerSwipeBound=false;
function initDrawerSwipe(dr){
  if(_drawerSwipeBound)return;
  _drawerSwipeBound=true;
  var startY=0,curY=0,dragging=false;
  function onStart(e){
    if(dr.scrollTop>2)return;
    startY=e.touches[0].clientY;curY=startY;dragging=true;
  }
  function onMove(e){
    if(!dragging)return;
    curY=e.touches[0].clientY;
    var dy=curY-startY;
    if(dy>0){dr.style.transform="translateY("+dy+"px)";e.preventDefault();}
    else{dragging=false;dr.style.transform="";}
  }
  function onEnd(){
    if(!dragging){dr.style.transform="";return;}
    var dy=curY-startY;
    dragging=false;
    if(dy>80){sn=null;hn=null;hideDrawer();draw();}
    dr.style.transform="";
  }
  dr.addEventListener("touchstart",onStart,{passive:true});
  dr.addEventListener("touchmove",onMove,{passive:false});
  dr.addEventListener("touchend",onEnd);
}

// --- Boot ---
init();
})();
