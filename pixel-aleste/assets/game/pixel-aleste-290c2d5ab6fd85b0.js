
'use strict';
const V3=THREE.Vector3;
const clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a),rint=(a,b)=>Math.floor(rnd(a,b+1)),lerp=(a,b,t)=>a+(b-a)*t,pick=a=>a[Math.floor(Math.random()*a.length)];
const D2R=Math.PI/180;
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const isTouch=matchMedia('(pointer:coarse)').matches;
const store={get(k,d){try{const v=localStorage.getItem('pw-'+k);return v===null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem('pw-'+k,JSON.stringify(v))}catch(e){}}};

/* =====================================================================
   렌더러 — 저해상도 렌더 후 픽셀 확대
   ===================================================================== */
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.domElement.id='gl';document.body.prepend(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(68,1,1,1500);
const hud=document.getElementById('hud'),hx=hud.getContext('2d');
let cw=1,ch=1,dpr=1,pxs=2,rh=1,baseFov=68;
function resize(){
  cw=innerWidth;ch=innerHeight;dpr=Math.min(devicePixelRatio||1,2);
  pxs=Math.max(2,Math.round(Math.min(cw,ch)/215));
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, isTouch?1.25:1.5));renderer.setSize(cw,ch,false);rh=renderer.domElement.height;
  hud.width=cw*dpr;hud.height=ch*dpr;camera.aspect=cw/ch;baseFov=cw<ch?82:64;camera.fov=baseFov;camera.updateProjectionMatrix();
}
addEventListener('resize',resize);resize();

/* =====================================================================
   복셀 모델 빌더
   ===================================================================== */
const FACES=[
  {d:[1,0,0],c:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],sh:0.8},{d:[-1,0,0],c:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]],sh:0.8},
  {d:[0,1,0],c:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],sh:1.0},{d:[0,-1,0],c:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],sh:0.5},
  {d:[0,0,1],c:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]],sh:0.9},{d:[0,0,-1],c:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]],sh:0.66}];
function voxGeo(fn,[x0,x1,y0,y1,z0,z1],s,centerY=true,tint=null){
  const W=x1-x0+1,H=y1-y0+1,D=z1-z0+1,grid=new Array(W*H*D);
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)grid[(x-x0)+W*((y-y0)+H*(z-z0))]=fn(x,y,z);
  const get=(x,y,z)=>(x<x0||x>x1||y<y0||y>y1||z<z0||z>z1)?null:grid[(x-x0)+W*((y-y0)+H*(z-z0))];
  const pos=[],col=[],cx=(x0+x1+1)/2,cy=centerY?(y0+y1+1)/2:y0,cz=(z0+z1+1)/2;
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++){
    const c=get(x,y,z);if(!c)continue;
    for(const F of FACES){
      if(get(x+F.d[0],y+F.d[1],z+F.d[2]))continue;
      let r=c[0],g=c[1],b=c[2];
      if(!c[3]){const sh=F.sh*(0.8+0.2*(y-y0)/Math.max(1,y1-y0));r*=sh;g*=sh;b*=sh;if(tint){r*=tint[0];g*=tint[1];b*=tint[2]}}
      const v=F.c.map(k=>[(x+k[0]-cx)*s,(y+k[1]-cy)*s,(z+k[2]-cz)*s]);
      for(const i of[0,1,2,0,2,3]){pos.push(...v[i]);col.push(r,g,b)}
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.computeVertexNormals();
  return projectSurfaceUV(g);
}
const VOXMAT=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.FrontSide});
const WHITEMAT=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
const glow=c=>[c[0],c[1],c[2],1];
const flipY=g=>{g.rotateY(Math.PI);return g};

/* ---------- 적기 (f = -z 가 기수) ---------- */
function jetShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=-z;
  if(f===8&&ax===0&&y===1)return p.tip;if(f>=6&&f<=7&&ax===0&&y>=1&&y<=2)return p.body;
  if(f>=-6&&f<=5&&ax<=1&&y>=1&&y<=2)return p.body;if(y===3&&ax===0&&f>=1&&f<=3)return p.canopy;
  if(y===1&&f>=-3&&f<=2){const hs=1+(2-f);if(ax<=hs)return ax===hs?p.wtip:p.wing}
  if(ax===1&&y>=3&&y<=4&&f>=-6&&f<=-4)return p.fin;if(y===1&&f>=-6&&f<=-5&&ax<=3)return p.wing;
  if(f===-7&&ax<=1&&y>=1&&y<=2)return p.engine;return null}}
function stealthShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=-z;
  if(f<-4||f>6)return null;const hs=Math.min(8,(6-f)*0.9);if(y<=1&&ax<=hs){if(f<=-3&&ax%3===2)return null;return ax>=hs-0.9?p.edge:p.body}
  if(y===2&&ax<=1&&f>=1&&f<=4)return p.canopy;if(f===-4&&y===1&&(ax===2||ax===3))return p.engine;return null}}
function heliShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=-z;
  if(Math.hypot(x,(y-2)*1.2,(f-1)*0.6)<=2.6)return(f>=3&&y>=2&&y<=3)?p.glass:p.body;
  if(y===2&&ax===0&&f>=-8&&f<=-2)return p.body;if(f===-8&&ax===0&&y>=2&&y<=4)return p.fin;
  if(y===0&&ax===2&&f>=-2&&f<=3)return p.dark;if(y===1&&ax===2&&(f===-1||f===2))return p.dark;
  if(y===2&&ax>=3&&ax<=4&&f>=0&&f<=1)return p.pod;
  if(y===5&&((x===0&&Math.abs(f-1)<=7)||(f===1&&ax<=7)))return p.dark;return null}}
function kamiShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=-z,ay=Math.abs(y-1);
  if(ax<=1&&ay<=1&&f>=-3&&f<=3)return f===3?p.tip:p.body;if(f===4&&ax===0&&ay===0)return p.tip;
  if(f===-3&&((ax===2&&ay===0)||(ax===0&&ay===2)))return p.fin;if(f===-4&&ax===0&&ay===0)return p.engine;return null}}
function droneShape(p){return(x,y,z)=>{const f=-z,ax=Math.abs(x),d=Math.hypot(x,z,(y-1)*1.3);
  if(d<=2.2)return(f>=2&&y===1&&ax===0)?p.eye:(y===2?p.top:p.body);if(y===1&&ax===3&&Math.abs(z)<=1)return p.wing;return null}}
function bomberShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=-z;
  if(ax<=2&&y>=1&&y<=3&&f>=-9&&f<=7)return(y===3&&ax<=1&&f>=3&&f<=5)?p.canopy:p.body;
  if(ax<=1&&y>=1&&y<=2&&f>=8&&f<=9)return f===9?p.tip:p.body;if(y===2&&f>=-2&&f<=3&&ax<=12)return ax>=11?p.wtip:p.wing;
  if((ax===5||ax===8)&&y===1&&f>=0&&f<=4)return f===4?p.tip:p.pod;if((ax===5||ax===8)&&y===1&&f===-1)return p.engine;
  if(ax<=5&&y===2&&f>=-9&&f<=-8)return p.wing;if(ax===0&&y>=4&&y<=6&&f>=-9&&f<=-6)return p.fin;return null}}
/* ---------- 지상/해상 표적 (기수 +z) ---------- */
function turretShape(p){return(x,y,z)=>{const d=Math.hypot(x,z);
  if(y<=1&&d<=3.2)return p.base;if(y===2&&d<=2.6)return p.dark;if(y>=3&&y<=4&&d<=2.1)return p.dome;if(y===4&&x===0&&z>=2&&z<=5)return p.dark;return null}}
function tankShape(p){return(x,y,z)=>{const ax=Math.abs(x);
  if(y===0&&ax>=2&&ax<=3&&Math.abs(z)<=4)return p.dark;if(y===1&&ax<=3&&Math.abs(z)<=4)return p.body;
  if(y===2&&Math.hypot(x,z+0.5)<=2.1)return p.top;if(y===2&&x===0&&z>=2&&z<=6)return p.dark;return null}}
function samShape(p){return(x,y,z)=>{const ax=Math.abs(x);
  if(y<=1&&ax<=3&&Math.abs(z)<=3)return y===0?p.dark:p.body;if(y>=2&&y<=4&&ax>=1&&ax<=2&&z>=y-3&&z<=y-1)return p.tube;if(y===5&&ax>=1&&ax<=2&&z===2)return p.tip;return null}}
function warshipShape(p,L=22,W=6){return(x,y,z)=>{const ax=Math.abs(x),f=z;
  const hw=f>L-8?W-(f-(L-8))*W/8:f<-L+4?W-(-L+4-f)*0.8:W;if(f<-L||f>L)return null;
  if(y<=3&&ax<=hw)return y===0?p.red:(y===3?p.deck:p.hull);
  if(y>=4&&y<=8&&ax<=2&&f>=-3&&f<=3)return y===8?p.dark:(y===6&&ax===2?glow([1,.85,.4]):p.tower);
  for(const tf of[Math.round(L*0.55),-Math.round(L*0.55)]){if(y>=4&&y<=5&&Math.hypot(x,f-tf)<=2.4)return p.dome;if(y===5&&ax===1&&f>=tf+2&&f<=tf+5)return p.dark}
  if(y>=4&&y<=7&&x===0&&f>=-7&&f<=-6)return p.dark;return null}}
/* ---------- 보스 ---------- */
function fortressShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=-z,hw=f>14?Math.max(0,6-(f-14)):6;
  if(ax<=hw&&y>=1&&y<=6&&f>=-20&&f<=20){if(y===6&&ax<hw)return p.deck;return(y===1||ax===hw)?p.dark:p.body}
  if(y>=2&&y<=3&&f>=-8&&f<=6&&ax<=18&&ax>hw)return ax>16?p.accent:(y===2?p.dark:p.wing);
  if(y===7&&ax<=1&&f>=0&&f<=3)return p.core;for(const[tx,tf]of[[3,10],[-3,10],[3,-10],[-3,-10]])if(y===7&&Math.hypot(x-tx,f-tf)<=1.6)return p.accent;
  if(y===4&&ax===14&&f>=6&&f<=10)return p.dark;if(f===-21&&ax<=5&&y>=2&&y<=5)return p.engine;return null}}
function crawlerShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=z;
  if(ax>=7&&ax<=10&&y<=3&&f>=-16&&f<=16)return(y===0||(f+y)%3===0)?p.dark:p.tread;
  if(ax<=8&&y>=3&&y<=6&&f>=-14&&f<=14)return y===6?p.top:p.body;
  if(y>=7&&y<=9&&Math.hypot(x,f*0.9)<=5)return y===9?p.top:p.body;if(y===8&&ax<=1&&f>=5&&f<=20)return p.dark;
  if(y===7&&ax===6&&f>=8&&f<=12)return p.dark;if(y===10&&ax<=1&&f>=-2&&f<=0)return glow([1,.3,.2]);return null}}
function gunshipShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=z;
  if(Math.hypot(x*1.1,(y-4)*1.2,(f-2)*0.48)<=5)return(f>=9&&y>=4&&y<=6)?p.glass:p.body;
  if(y>=4&&y<=5&&ax<=1&&f>=-20&&f<=-6)return p.body;if(f===-20&&ax===0&&y>=3&&y<=9)return p.accent;
  if(y===3&&ax<=10&&ax>=4&&f>=-1&&f<=3)return p.dark;if(y>=2&&y<=3&&ax>=9&&ax<=10&&f>=-2&&f<=5)return f===5?glow([1,.4,.2]):p.pod;
  if(y===0&&ax===3&&f>=-4&&f<=6)return p.dark;return null}}
function crabShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=z;
  if(Math.hypot(x,(y-6)*1.5,f*0.85)<=9)return(f>=6&&y===8&&ax===3)?glow([.3,1,.9]):(y>=8?p.top:p.body);
  if(ax>=11&&ax<=14&&y>=4&&y<=8&&f>=6&&f<=12)return(ax===14&&f>=10)?p.dark:p.claw;if(ax>=8&&ax<=11&&y===6&&f>=3&&f<=7)return p.claw;
  for(const lf of[-6,0,5]){const lx=8+(6-y);if(y<=5&&Math.abs(ax-lx)<=0.6&&Math.abs(f-lf)<=0.6)return p.dark}
  if(y===1&&ax<=5&&Math.abs(f)<=4)return glow([.4,.9,1]);return null}}
function centHeadShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=z;
  if(Math.hypot(x,(y-4)*1.1,f*0.9)<=5)return(f>=3&&y===6&&ax===2)?glow([1,.2,.2]):(y>=6?p.top:p.body);
  if(y===3&&ax>=2&&ax<=4&&f>=4&&f<=8&&ax+f>=7)return p.dark;return null}}
function centSegShape(p){return(x,y,z)=>{const ax=Math.abs(x);
  if(Math.hypot(x,(y-4)*1.15,z*1.3)<=4.2)return y>=6?p.top:(y===4?p.dark:p.body);if(y===2&&ax>=4&&ax<=6&&Math.abs(z)<=0)return p.dark;return null}}
function zepShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=z;
  if(Math.hypot(x/7,(y-9)/7,f/23)<=1)return(Math.abs(f)%7===0)?p.stripe:p.env;
  if(f<=-17&&f>=-23&&((ax<=0.5&&Math.abs(y-9)<=10)||(Math.abs(y-9)<=0.5&&ax<=10)))return p.stripe;
  if(y>=0&&y<=2&&ax<=3&&f>=-6&&f<=8)return(y===1&&ax===3&&f%2===0)?glow([1,.85,.4]):p.gon;
  if(y===4&&ax===8&&f>=-6&&f<=-2)return f===-6?glow([1,.6,.2]):p.gon;return null}}
function wingShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=z;if(f<-10||f>16)return null;
  const hs=Math.min(26,(16-f)*1.35);if(ax>hs)return null;const th=ax<=4?4:ax<=10?2:1;
  if(y<th)return ax>=hs-1.2?p.edge:(y===th-1?p.top:p.body);if(f===-10&&y<=1&&ax>=4&&ax<=8)return p.engine;
  if(y===th&&ax<=1&&f>=6&&f<=10)return p.glass;return null}}
function skyShipShape(){const H=[.66,.7,.76],HD=[.44,.47,.55],RD=[.74,.2,.17],DK=[.16,.18,.24],DE=[.52,.54,.58],WD=[.55,.36,.22],
  W=glow([1,.86,.5]),B=glow([.45,.85,1]),O=glow([1,.6,.2]);
  const hwAt=(y,z)=>{const keel=y<0?Math.pow(-y/8,1.5)*9:0,bow=z>18?Math.max(0,(42-z)/24):1,st=z<-34?0.92:1;return(10-keel)*Math.sqrt(bow)*st};
  return(x,y,z)=>{const ax=Math.abs(x);
  if(y>=-8&&y<=2&&z>=-40&&z<=42){const hw=hwAt(y,z);if(ax<=hw){
    if(z<=-36&&ax<=3&&y>=-4&&y<=-1)return null;
    if(z===-35&&ax<=3&&y>=-4&&y<=-1)return y===-4?B:DK;
    if(z<=-38&&ax<=4&&(ax===4||y===0||y===-5)&&y>=-5&&y<=0)return(ax+y)%2?B:W;
    if(y===-8)return RD;if(y===1)return(z%8===0)?W:RD;
    if(y===-2&&ax>=hw-1&&((z+40)%5===0))return W;
    return y<-4?HD:H}}
  if(y===3&&z>=-38&&z<=40&&ax<=hwAt(2,z))return(x===0&&((z+40)%6)<3)?[.95,.95,.9]:(ax>=hwAt(2,z)-1?RD:DE);
  if(y>=4&&y<=11&&z>=0&&z<=16&&ax<=(y>8?3:5)){if(y===9&&(z%3)!==0)return B;if(y===6&&ax===5&&z%4===1)return W;return y===11?RD:H}
  if(y>=12&&y<=15&&x===0&&z===9)return y===15?glow([1,.2,.2]):DK;
  if(y>=12&&y<=13&&ax<=1&&z>=4&&z<=6)return DK;
  if(y>=0&&y<=1&&ax>=11&&ax<=21){const z0=-16+(ax-11)*0.9,z1=-2-(ax-11)*0.5;if(z>=z0&&z<=z1)return(ax===21||y===1&&ax%3===0)?RD:H}
  if(ax>=19&&ax<=23&&y>=-3&&y<=1&&z>=-22&&z<=-4){if(z===-22)return O;if(z===-4)return DK;return(y===-3||ax===23)?HD:DK}
  if(z===-41&&ax>=6&&ax<=8&&y>=-5&&y<=-3)return O;
  if(y>=4&&y<=6&&z>=-30&&z<=-24&&ax>=6&&ax<=8)return WD;
  return null}}
function carrierShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=z;
  if(ax<=10&&y<=5&&f>=-26&&f<=26-Math.max(0,0))return y===0?p.dark:(y===3&&f%6===0?glow([1,.8,.4]):p.hull);
  if(y===6&&ax<=12&&f>=-26&&f<=26)return(x===0&&((f+40)%5)<2)?[.95,.95,.9]:p.deck;
  if(y>=7&&y<=12&&x>=8&&x<=10&&f>=-4&&f<=4)return y===10?glow([.5,.85,1]):p.tower;if(y===13&&x===9&&f===0)return glow([1,.2,.2]);
  if(f===-27&&ax<=8&&y>=1&&y<=4)return p.engine;return null}}

function heavyTankShape(p){return(x,y,z)=>{const ax=Math.abs(x),f=z;
  if(ax>=5&&ax<=7&&y<=2&&f>=-10&&f<=10)return(y===0||(f+y)%3===0)?p.dark:p.tread;
  if(ax<=6&&y>=2&&y<=4&&f>=-9&&f<=9)return y===4?p.top:p.body;
  if(y>=5&&y<=7&&Math.hypot(x,(f+1)*0.9)<=4.2)return y===7?p.top:p.body;
  if(y===6&&(x===-1||x===1)&&f>=3&&f<=14)return p.dark;if(y===8&&x===2&&f>=-2&&f<=0)return p.dark;if(y===5&&ax===6&&f>=6&&f<=9)return p.dark;return null}}
/* 인간형 로봇: 기수(정면) +z, 발바닥 y=0, 코어 y≈25 */
function robotShape(p,o){return(x,y,z)=>{const ax=Math.abs(x),az=Math.abs(z);
  if(o.cut&&y<o.cut)return null;
  if(y<=1&&ax>=2&&ax<=6&&z>=-2&&z<=4)return p.dark;
  if(y<=15&&ax>=2&&ax<=6&&az<=2)return y===8?p.joint:((ax===6||z===2)?p.armor:p.frame);
  if(y>=15&&y<=17&&ax<=6&&az<=3)return p.frame;
  if(y>=18&&y<=29){const hw=y<22?6:8;if(ax<=hw&&z>=-4&&z<=4){if(z===4&&ax<=1&&y>=24&&y<=26)return p.core;if(z===4&&y>=27&&ax<=5)return p.accent;return(y===18||ax===hw)?p.frame:p.armor}}
  if(y>=27&&y<=30&&ax>=9&&ax<=12&&az<=3)return y===30?p.accent:p.armor;
  if(y>=15&&y<=26&&ax>=10&&ax<=12&&az<=2)return y===20?p.joint:p.frame;
  if(y>=12&&y<=14&&ax>=9&&ax<=13&&az<=2)return p.dark;
  if(y>=31&&y<=35&&ax<=3&&az<=3){if(z===3&&y===33&&ax<=2)return p.eye;return p.armor}
  if(o.horns&&y>=35&&y<=38&&ax===3-(y-35)+1&&z===1)return p.accent;
  if(o.cannons&&y>=31&&y<=32&&ax>=9&&ax<=10&&z>=-1&&z<=8)return z===8?p.eye:p.dark;
  if(o.wings&&z>=-6&&z<=-5&&y>=19&&y<=37&&ax>=6&&ax<=Math.min(22,6+(37-y)*1.1))return ax>=19?p.accent:p.wing;
  if(o.jets&&z===-5&&y>=20&&y<=26&&ax>=3&&ax<=5)return p.engine;
  return null}}
function mountainShape(seed,snow=true){const r=mulberry(seed),ph=[r()*6,r()*6];return(x,y,z)=>{const a=Math.atan2(z,x),H=24+Math.round(Math.sin(a*2+ph[0])*2);if(y>H)return null;
  const rad=(14+Math.sin(a*3+ph[1])*2)*(1-y/(H+1));if(Math.hypot(x,z)>rad)return null;
  if(snow&&y>=H-6)return[.95,.97,1];if(y>=H-11)return(y%3===0)?CP.rock2:CP.rock;return y<4?CP.grass2:(y%3===0?CP.pine2:CP.pine)}}
function floatIslandShape(seed){const r=mulberry(seed),R=7+Math.floor(r()*4),tr=[];for(let i=0;i<3;i++)tr.push([r()*8-4,r()*8-4]);return(x,y,z)=>{const d=Math.hypot(x,z);
  if(y<=11){const rr=R*Math.pow(y/11,0.7);if(d<=rr)return y===11?CP.grass:(y%3===0?CP.rock2:[.55,.42,.32]);return null}
  const ty=y-12;for(const[tx,tz]of tr){if(ty<=3&&Math.hypot(x-tx,z-tz)<0.8)return CP.trunk;if(Math.hypot(x-tx,(ty-5)*1.2,z-tz)<=2.6)return CP.leaf}return null}}
function ruinShape(seed){const r=mulberry(seed),w=2+Math.floor(r()*2),h=6+Math.floor(r()*9),cut=r()*6.28;return(x,y,z)=>{const ax=Math.abs(x),az=Math.abs(z);if(ax>w||az>w||y>h)return null;
  const brk=h-3+Math.round(Math.sin(x*1.3+cut)*2+Math.cos(z*1.1)*2);if(y>brk)return null;if(((x*7+y*13+z*5)&15)===0)return null;
  const edge=ax===w||az===w;if(edge&&y%2===1&&((x*3+z*5+y)%4===0))return glow([1,.5,.12]);return(y%5===0)?[.22,.2,.22]:[.34,.31,.33]}}
function overpassShape(c1,c2){return(x,y,z)=>{const ax=Math.abs(x),az=Math.abs(z);if(ax>70||az>3)return null;
  if(y>=10&&y<=11&&az<=3)return(y===11&&z===0&&((x+70)%6<3))?[.95,.9,.55]:(y===11?c2:c1);if(y===12&&az===3)return[.75,.75,.78];
  if(x%18===0&&y<=9&&az<=1)return c1;if(x%18===0&&y===9&&az<=3)return c1;if(y===13&&az===3&&x%9===0)return glow([1,.85,.5]);return null}}
function hopperShape(p){return(x,y,z)=>{const ax=Math.abs(x);
  if(Math.hypot(x,(y-4)*1.25,z)<=3.3)return(z>=2&&y===5&&ax===1)?p.eye:(y>=6?p.top:p.body);
  if(ax>=3&&ax<=4&&y<=3&&z>=-2&&z<=1)return y===0?p.dark:p.leg;if(ax===4&&y>=2&&y<=4&&z<=-2&&z>=-3)return p.leg;return null}}
function mlrsShape(p){return(x,y,z)=>{const ax=Math.abs(x);
  if(y===0&&ax>=2&&ax<=3&&(z===-4||z===-1||z===3))return p.dark;if(y>=1&&y<=2&&ax<=3&&z>=-5&&z<=5)return y===2&&z>=3?p.cab:p.body;
  if(y===3&&ax<=3&&z>=3&&z<=5)return p.cab;const py=3+Math.round((z+4)*0.35);if(z>=-4&&z<=2&&ax<=2&&y>=py&&y<=py+1)return(z===2&&(x+y)%2===0)?p.tip:p.pod;return null}}
function whaleShape(p){return(x,y,z)=>{const ax=Math.abs(x);
  if(Math.hypot(x/9,(y-8)/7,z/24)<=1){if(z>=13&&y===10&&ax>=6&&ax<=7)return p.eye;if(y<=4)return p.belly;if(y>=14&&Math.abs(z)%6===0&&ax<=2)return p.light;return(Math.abs(z)%8===0)?p.plate:p.body}
  if(y>=6&&y<=7&&ax>=8&&ax<=17&&z>=-2&&z<=8-(ax-8)*0.6)return p.fin;if(z<=-23&&z>=-30&&y>=7&&y<=9&&ax<=4+(-23-z)*0.9)return p.fin;
  if(y===15&&ax<=1&&z>=-4&&z<=4)return p.plate;if(y===16&&x===0&&z>=-2&&z<=2)return p.light;return null}}
function mantaShape(p){return(x,y,z)=>{const ax=Math.abs(x),hs=22*(1-Math.abs(z-2)/16);
  if(z>=-14&&z<=18&&y>=2&&y<=3&&ax<=hs)return ax>=hs-1.2?p.edge:(y===3?p.top:p.body);
  if(y>=4&&y<=5&&ax<=4&&z>=-6&&z<=12)return(z>=10&&y===5&&ax>=2&&ax<=3)?p.eye:p.top;
  if(x===0&&y===3&&z<=-14&&z>=-28)return z%3===0?p.edge:p.body;if(z>=17&&z<=20&&y>=1&&y<=3&&ax>=3&&ax<=5)return p.body;return null}}
function beetleShape(p){return(x,y,z)=>{const ax=Math.abs(x);
  if(Math.hypot(x/8,(y-6)/6,z/12)<=1){if(y>=8&&x===0)return p.stripe;if(z>=10&&y===6&&ax>=3&&ax<=4)return p.eye;return y<=3?p.under:p.shell}
  if(y===9&&ax>=7&&ax<=19&&z>=-6&&z<=8-(ax-7)*0.4)return(ax+z)%4===0?p.vein:p.wing;
  if(y>=6&&y<=8&&x===0&&z>=11&&z<=18)return z>=17?p.eye:p.horn;if(y>=8&&y<=9&&x===0&&z===18)return p.horn;
  for(const lz of[-6,0,6])if(ax>=6&&ax<=8&&y>=0&&y<=2&&Math.abs(z-lz)<=0)return p.under;return null}}
const P_={
  player:{body:[.92,.95,1],wing:[.22,.5,.98],wtip:[1,.86,.2],canopy:[.3,.95,1],fin:[.22,.5,.98],engine:glow([1,.62,.2]),tip:[1,.3,.3]},
  red:{body:[.62,.18,.18],wing:[.45,.13,.15],wtip:[1,.85,.3],canopy:[.35,.95,1],fin:[.8,.22,.2],engine:glow([1,.6,.2]),tip:[.9,.9,.9]},
  grey:{body:[.34,.36,.42],wing:[.25,.27,.33],wtip:[1,.32,.3],canopy:[1,.8,.3],fin:[.9,.3,.25],engine:glow([1,.6,.2]),tip:[.9,.9,.9]},
  ace:{body:[.88,.56,.15],wing:[.6,.35,.1],wtip:[.15,.15,.15],canopy:[.35,.95,1],fin:[.2,.2,.24],engine:glow([1,.6,.2]),tip:[.2,.2,.2]},
  stealth:{body:[.16,.14,.22],edge:[.85,.15,.25],canopy:glow([1,.3,.4]),engine:glow([.6,.4,1])},
  heli:{body:[.35,.42,.3],glass:[.4,.9,1],fin:[.8,.25,.2],dark:[.15,.16,.15],pod:[.55,.55,.5]},
  kami:{body:[.85,.85,.82],tip:glow([1,.25,.2]),fin:[.3,.3,.35],engine:glow([1,.7,.3])},
  drone:{body:[.42,.3,.55],top:[.6,.45,.75],eye:glow([1,.25,.35]),wing:[.3,.3,.35]},
  bomber:{body:[.38,.45,.28],wing:[.3,.36,.22],wtip:[1,.85,.3],canopy:[.35,.95,1],pod:[.25,.28,.2],engine:glow([1,.6,.2]),tip:[.8,.8,.75],fin:[.45,.5,.3]},
  turret:{base:[.5,.5,.55],dark:[.25,.25,.3],dome:[.8,.25,.2]},
  tank:{body:[.4,.46,.3],top:[.48,.55,.36],dark:[.22,.24,.2]},
  sam:{body:[.45,.5,.4],dark:[.2,.22,.2],tube:[.75,.75,.7],tip:glow([1,.3,.2])},
  ship:{hull:[.42,.45,.5],deck:[.55,.57,.6],red:[.6,.18,.15],tower:[.6,.62,.66],dome:[.35,.37,.42],dark:[.18,.19,.22]},
  boat:{hull:[.3,.4,.3],deck:[.5,.55,.45],red:[.5,.2,.15],tower:[.6,.62,.55],dome:[.3,.35,.3],dark:[.15,.16,.15]}
};
const PB2={
  tank:{tread:[.28,.27,.24],dark:[.14,.14,.12],body:[.42,.46,.36],top:[.52,.56,.44]},
  condor:{body:[.32,.34,.38],wing:[.24,.26,.3],wtip:[.9,.2,.2],canopy:[.4,.9,1],pod:[.2,.2,.24],engine:glow([1,.55,.2]),tip:[.85,.85,.8],fin:[.85,.2,.2]},
  golem:{frame:[.38,.4,.36],armor:[.66,.6,.42],dark:[.18,.18,.18],joint:[.28,.28,.28],accent:[.9,.62,.2],core:glow([1,.55,.15]),eye:glow([1,.2,.15]),wing:[.5,.5,.5],engine:glow([1,.6,.2])},
  triton:{frame:[.26,.3,.38],armor:[.18,.46,.62],dark:[.12,.14,.18],joint:[.2,.22,.26],accent:[.95,.82,.3],core:glow([.3,1,1]),eye:glow([.4,1,1]),wing:[.4,.6,.7],engine:glow([.4,.8,1])},
  valk:{frame:[.34,.38,.5],armor:[.92,.92,.96],dark:[.2,.22,.3],joint:[.3,.32,.4],accent:[.88,.18,.24],core:glow([.4,1,.5]),eye:glow([1,.95,.3]),wing:[.72,.8,.96],engine:glow([.5,.75,1])},
  titan:{frame:[.16,.16,.2],armor:[.28,.27,.32],dark:[.1,.1,.12],joint:[.2,.2,.24],accent:[.92,.14,.18],core:glow([1,.15,.2]),eye:glow([1,.2,.2]),wing:[.42,.1,.14],engine:glow([1,.4,.2])},
  colossus:{frame:[.3,.3,.34],armor:[.66,.66,.7],dark:[.16,.16,.18],joint:[.24,.24,.28],accent:[.96,.76,.26],core:glow([1,.3,.9]),eye:glow([1,1,1]),wing:[.5,.5,.55],engine:glow([1,.6,.3])}};
const PB={
  ship:{hull:[.36,.38,.44],deck:[.5,.5,.52],red:[.65,.16,.14],tower:[.58,.6,.64],dome:[.3,.32,.38],dark:[.15,.16,.2]},
  crawler:{tread:[.3,.28,.24],dark:[.15,.14,.12],body:[.55,.45,.3],top:[.65,.55,.38]},
  heli:{body:[.28,.34,.26],glass:[.45,.95,1],accent:[.85,.2,.2],dark:[.14,.15,.14],pod:[.5,.5,.46]},
  crab:{body:[.85,.32,.2],top:[.95,.5,.3],claw:[.7,.22,.15],dark:[.25,.15,.12]},
  cent:{body:[.25,.5,.3],top:[.45,.8,.4],dark:[.1,.2,.12]},
  zep:{env:[.82,.82,.86],stripe:[.75,.2,.2],gon:[.3,.3,.36]},
  wing:{body:[.18,.18,.22],top:[.26,.26,.32],edge:[.9,.75,.2],engine:glow([1,.5,.2]),glass:glow([.5,1,.9])},
  carrier:{hull:[.32,.35,.42],dark:[.16,.17,.2],deck:[.4,.42,.46],tower:[.55,.57,.62],engine:glow([.5,.7,1])},
  fortress:{body:[.36,.38,.46],deck:[.46,.48,.56],dark:[.2,.21,.26],wing:[.3,.32,.4],accent:[.85,.2,.2],core:glow([1,.25,.6]),engine:glow([1,.6,.2])}
};
const GEO={
  player:voxGeo(introJetShape,[-14,14,0,13,-22,16],0.42),
  fighter:flipY(voxGeo(jetShape(P_.red),[-6,6,0,4,-8,8],0.9)),
  fighter2:flipY(voxGeo(jetShape(P_.grey),[-6,6,0,4,-8,8],0.9)),
  ace:flipY(voxGeo(jetShape(P_.ace),[-6,6,0,4,-8,8],1)),
  stealth:flipY(voxGeo(stealthShape(P_.stealth),[-9,9,0,2,-7,5],1.1)),
  heli:flipY(voxGeo(heliShape(P_.heli),[-8,8,0,5,-8,8],1.1)),
  kami:flipY(voxGeo(kamiShape(P_.kami),[-3,3,-1,3,-5,5],1)),
  drone:flipY(voxGeo(droneShape(P_.drone),[-3,3,0,2,-3,3],1.2)),
  bomber:flipY(voxGeo(bomberShape(P_.bomber),[-12,12,0,6,-10,10],1.2)),
  turret:voxGeo(turretShape(P_.turret),[-4,4,0,5,-4,6],1.3,false),
  tank:voxGeo(tankShape(P_.tank),[-4,4,0,2,-5,7],1.3,false),
  sam:voxGeo(samShape(P_.sam),[-4,4,0,5,-4,4],1.4,false),
  destroyer:voxGeo(warshipShape(P_.ship,14,4),[-5,5,0,8,-15,15],1.4,false),
  boat:voxGeo(warshipShape(P_.boat,8,3),[-4,4,0,8,-9,9],1.1,false),
  walker:voxGeo(robotShape({frame:[.32,.34,.3],armor:[.55,.6,.42],dark:[.15,.16,.14],joint:[.25,.26,.24],accent:[.9,.5,.15],core:glow([1,.5,.15]),eye:glow([1,.25,.2]),wing:[.4,.4,.4],engine:glow([1,.6,.2])},{cannons:true}),[-23,23,0,38,-7,9],0.38,false),
  hopper:voxGeo(hopperShape({body:[.25,.55,.3],top:[.4,.75,.4],eye:glow([1,.9,.2]),leg:[.2,.3,.22],dark:[.12,.15,.12]}),[-5,5,0,7,-4,4],1.5,false),
  mlrs:voxGeo(mlrsShape({body:[.42,.44,.36],cab:[.5,.52,.44],dark:[.12,.12,.12],pod:[.3,.32,.3],tip:glow([1,.35,.2])}),[-4,4,0,7,-6,6],1.5,false),
  m_whale:voxGeo(whaleShape({body:[.32,.44,.6],belly:[.72,.78,.84],plate:[.24,.3,.4],fin:[.28,.38,.52],eye:glow([1,.25,.2]),light:glow([.5,.95,1])}),[-18,18,0,17,-31,25],2),
  m_manta:voxGeo(mantaShape({body:[.38,.2,.5],top:[.5,.28,.62],edge:glow([.35,1,.85]),eye:glow([1,.9,.3])}),[-23,23,0,6,-29,21],2.1),
  m_beetle:voxGeo(beetleShape({shell:[.2,.5,.32],stripe:[.85,.75,.2],under:[.15,.2,.16],eye:glow([1,.2,.25]),wing:[.55,.75,.9],vein:[.3,.45,.6],horn:[.3,.32,.3]}),[-20,20,0,13,-13,19],2),
  b_tank:voxGeo(heavyTankShape(PB2.tank),[-8,8,0,8,-11,15],2.4,false),
  b_crawler:voxGeo(crawlerShape(PB.crawler),[-11,11,0,10,-17,21],2.4,false),
  b_condor:flipY(voxGeo(bomberShape(PB2.condor),[-12,12,0,6,-10,10],3.6)),
  b_wing:voxGeo(wingShape(PB.wing),[-27,27,0,5,-11,17],2),
  r_golem:voxGeo(robotShape(PB2.golem,{cannons:true}),[-23,23,0,38,-7,9],1.5,false),
  r_triton:voxGeo(robotShape(PB2.triton,{cut:14,horns:true}),[-23,23,0,38,-7,9],2.2,false),
  r_valk:voxGeo(robotShape(PB2.valk,{wings:true,horns:true,jets:true}),[-23,23,0,38,-7,9],2.2,false),
  r_titan:voxGeo(robotShape(PB2.titan,{wings:true,cannons:true,horns:true,jets:true}),[-23,23,0,38,-7,9],3.2,false),
  r_colossus:voxGeo(robotShape(PB2.colossus,{cannons:true,horns:true}),[-23,23,0,38,-7,9],6.5,false)
};
const ROTOR_GEO=new THREE.BoxGeometry(30,0.6,1.6),ROTOR_GEO2=new THREE.BoxGeometry(1.6,0.6,30),ROTOR_MAT=new THREE.MeshBasicMaterial({color:0x202224});

/* ---------- 월드 소품 ---------- */
const CP={wet:[.77,.66,.42],sand:[.91,.81,.56],grass:[.42,.68,.3],grass2:[.3,.54,.24],trunk:[.54,.35,.17],leaf:[.27,.63,.24],leaf2:[.17,.48,.18],rock:[.55,.57,.62],rock2:[.44,.45,.5],pine:[.18,.45,.26],pine2:[.12,.36,.2]};
function islandShape(R,seed){
  const r=mulberry(seed),Ll=5,wob=[];for(let i=0;i<5;i++)wob.push([r()*6.28,1+Math.floor(r()*4),r()*0.16]);
  const rad=(x,z)=>{const a=Math.atan2(z,x);let m=1;for(const[p,f,amp]of wob)m+=Math.sin(a*f+p)*amp;return m};
  const trees=[];const nt=Math.max(1,Math.floor(R/4))+Math.floor(r()*2);
  for(let i=0;i<nt;i++){const a=r()*6.28,d=r()*R*0.5;trees.push([Math.cos(a)*d,Math.sin(a)*d,6+Math.floor(r()*4),r()*6.28])}
  const rocky=r()<0.3;
  return{fn:(x,y,z)=>{const d=Math.hypot(x,z)/rad(x,z);
    if(y<Ll){const rr=R*(1-y/(Ll*1.7));if(d<=rr){if(y===0)return CP.wet;if(y<2)return CP.sand;if(rocky)return y<4?CP.rock:CP.grass2;return d>rr-1.4?CP.grass2:CP.grass}return null}
    const ty=y-Ll;for(const[tx,tz,th,lean]of trees){const ex=x-tx-Math.cos(lean)*ty*0.18,ez=z-tz-Math.sin(lean)*ty*0.18;
      if(ty<th&&Math.abs(ex)<0.8&&Math.abs(ez)<0.8)return CP.trunk;
      if(ty>=th-1&&ty<=th+1){const ad=Math.hypot(ex,ez),arm=Math.abs(ex)<0.9||Math.abs(ez)<0.9||Math.abs(Math.abs(ex)-Math.abs(ez))<0.9;const lim=ty===th+1?2.2:(ty===th?4.3:3.6);if(ad<lim&&arm)return ty===th-1?CP.leaf2:CP.leaf;if(ty===th+1&&ad<1.4)return CP.leaf}}
    return null},range:[-R-6,R+6,0,Ll+12,-R-6,R+6],top:Ll*2};
}
const pineShape=(x,y,z)=>{const d=Math.hypot(x,z);if(y<=2&&d<0.8)return CP.trunk;if(y>=3&&y<=11){const r=(11-y)*0.42+0.6;if(d<=r)return y%2?CP.pine:CP.pine2}return null};
const roundTreeShape=(x,y,z)=>{const d=Math.hypot(x,z);if(y<=3&&d<0.8)return CP.trunk;if(Math.hypot(x,(y-6)*1.15,z)<=3.2)return y<5?CP.leaf2:CP.leaf;return null};
const palmShape=(x,y,z)=>{const ex=x-y*0.15;if(y<=7&&Math.abs(ex)<0.8&&Math.abs(z)<0.8)return CP.trunk;if(y>=7&&y<=8){const a=Math.abs(ex-1),ad=Math.hypot(ex-1,z);if(ad<(y===8?2.4:4.2)&&(a<0.9||Math.abs(z)<0.9||Math.abs(a-Math.abs(z))<0.9))return y===7?CP.leaf2:CP.leaf}return null};
const reedShape=(x,y,z)=>{if(y<=3&&((x+z)%2===0)&&Math.abs(x)<=2&&Math.abs(z)<=2&&y<=2+((x*7+z*3)&1))return y===3?[.75,.6,.3]:[.45,.6,.25];return null};
function houseShape(roof,win){return(x,y,z)=>{const ax=Math.abs(x),az=Math.abs(z);
  if(y<=3&&ax<=3&&az<=2){const edge=ax===3||az===2;if(edge&&y>=1&&y<=2&&((ax===3&&z===0)||(az===2&&ax===1)))return win;return y===0?[.6,.55,.5]:[.93,.88,.78]}
  if(y>=4&&y<=6){const w=6-y;if(az<=w+0.5&&ax<=4)return roof}if(y>=4&&y<=6&&x===2&&z===-1)return[.5,.35,.3];return null}}
const barnShape=(x,y,z)=>{const ax=Math.abs(x),az=Math.abs(z);if(y<=4&&ax<=4&&az<=3)return(az===3&&ax<=1&&y<=2)?[.3,.15,.1]:[.72,.2,.15];if(y>=5&&y<=7&&ax<=4&&az<=8-y)return[.35,.32,.3];return null};
const hayShape=(x,y,z)=>Math.hypot(x,(y-1)*1.3,z)<=1.8?[.9,.78,.35]:null;
function towerShape(light,stripe){return(x,y,z)=>{const d=Math.hypot(x,z);
  if(y<=1&&d<=3)return CP.rock2;if(y<=13&&d<=1.8)return stripe&&((y>>1)%2)?[.85,.2,.2]:[.92,.92,.9];
  if(y===14&&d<=2.2)return[.2,.2,.24];if(y===15&&d<=1.4)return light;if(y===16&&d<=1)return[.7,.15,.15];return null}}
function cliffShape(seed,top,c1,c2){const r=mulberry(seed),ph=[r()*6,r()*6,r()*6];return(x,y,z)=>{
  const a=Math.atan2(z,x),h=17+Math.round(Math.sin(a*2+ph[0])*2);if(y>h)return null;
  const rad=(5.2+Math.sin(a*3+ph[1])*0.9+Math.sin(a*5+ph[2]+y*0.3)*0.6)*(1-y/(h*2.6));if(Math.hypot(x,z)>rad)return null;
  if(y===h&&top)return top;return(y%4===0)?c2:c1}}
const shipShape=(x,y,z)=>{const ax=Math.abs(x),f=-z,hw=f>3?2-(f-3)*0.6:2;
  if(y<=1&&f>=-6&&f<=6&&ax<=hw)return y===0?[.25,.2,.25]:[.75,.25,.2];if(y>=2&&y<=3&&ax<=1&&f>=-4&&f<=-1)return[.95,.95,.92];if(x===0&&y>=2&&y<=6&&f===1)return[.5,.4,.3];return null};
function buildingShape(seed,hMin,hMax,win){const r=mulberry(seed),w=2+Math.floor(r()*2),h=hMin+Math.floor(r()*(hMax-hMin+1)),base=[[.62,.6,.58],[.5,.55,.62],[.7,.66,.6],[.3,.33,.4]][Math.floor(r()*4)];
  return(x,y,z)=>{const ax=Math.abs(x),az=Math.abs(z);if(ax>w||az>w||y>h+1)return null;
    if(y===h+1)return(ax===0&&az===0)?glow([1,.2,.2]):null;if(y===h)return[.25,.27,.32];
    const edge=ax===w||az===w;if(edge&&y%2===1&&((x+z+y)%3!==0))return win?glow(r()<0.8?[1,.85,.45]:[.5,.8,1]):[.35,.55,.75];return base}}
const slabShape=(x,y,z)=>{if(y===0)return CP.sand;const e=x<=-9||x>=8||z<=-9||z>=8;return e?CP.sand:CP.grass};
function bridgeShape(c1,c2){return(x,y,z)=>{const ax=Math.abs(x),az=Math.abs(z);if(ax>70||az>3)return null;
  if(y>=11&&y<=12&&az<=2)return y===12?c2:c1;if(x%20===0&&y<=10&&az<=1)return c1;
  const top=13+Math.round(8*(1-(x/70)*(x/70)));if(az===2&&y>12&&(y===top||(x%7===0&&y<top)))return c1;return null}}
function cloudShape(seed){const r=mulberry(seed),bl=[];const n=3+Math.floor(r()*3);for(let i=0;i<n;i++)bl.push([r()*14-7,r()*2,r()*8-4,2.5+r()*3]);
  return(x,y,z)=>{for(const[bx,by,bz,br]of bl)if(Math.hypot(x-bx,(y-by)*1.6,z-bz)<=br)return y<=1?[.86,.9,.97]:[1,1,1];return null}}

/* =====================================================================
   월드 레벨 9종
   ===================================================================== */
const sourceThemes=[
  {name:'METRO CITY',kr:'도시',kind:'city',top:'#4a8fe0',hor:'#dfe8f0',fog:0xdde6ee,ground:['city','#4a4a52','#62626c','#e0c860'],tint:null,tr:0},
  {name:'GREAT PLAINS',kr:'대지',kind:'land',top:'#4f9ae8',hor:'#e6f2e0',fog:0xe0eedc,ground:['fields','#6aa244','#8cbc54','#c8b860'],tint:null,tr:2},
  {name:'RED CANYON',kr:'협곡',kind:'canyon',top:'#3a7ad0',hor:'#ffd8a8',fog:0xf4c89a,ground:['desert','#c47a46','#e0a066','#9a5a32'],tint:null,tr:-3},
  {name:'RIVER CROSSING',kr:'강과 다리',kind:'river',top:'#5aa6e8',hor:'#fff1d6',fog:0xf4ecd8,ground:['grass','#5a9a40','#78b452','#45803a'],tint:[1,.97,.92],tr:-1},
  {name:'MOUNTAIN VILLAGE',kr:'산마을',kind:'mountain',top:'#3c86d8',hor:'#e8f0f8',fog:0xdce8f2,ground:['grass','#4f8f3c','#6aa84c','#3e7432'],tint:null,tr:3},
  {name:'OPEN SEA',kr:'바다',kind:'sea',top:'#2a6cc0',hor:'#ffcf9a',fog:0xf6c9a0,ground:['sea','#2a78b8','#f0b080','#1f5f98'],tint:[1,.92,.86],tr:-2},
  {name:'ABOVE THE CLOUDS',kr:'하늘',kind:'sky',top:'#1f6fd8',hor:'#cfe8ff',fog:0xdcebfb,ground:['cloud','#eef4fb','#ffffff','#cdd8e6'],tint:null,tr:1},
  {name:'STRATOSPHERE',kr:'성층권',kind:'strato',top:'#020418',hor:'#3a7ab8',fog:0x3a6aa0,ground:['cloud','#7f97c4','#a8bce0','#5f77a4'],tint:[.75,.82,1],stars:true,tr:4},
  {name:'FALLEN CAPITAL',kr:'최종 결전',kind:'ruins',top:'#0a0612',hor:'#7a2a1a',fog:0x4a1e18,ground:['night','#18141a','#3a2a26','#2a1a16'],tint:[.62,.5,.5],stars:true,tr:-4}
];
const campaignSourceStages=[1, 2, 3, 4, 5, 9];
const THEMES=campaignSourceStages.map(source=>sourceThemes[source-1]);
const NSTAGE=THEMES.length;
function campaignStage(value){
  const number=Number(value);
  return Number.isFinite(number)?Math.min(NSTAGE,Math.max(1,Math.trunc(number))):1;
}
function stageSourceNumber(number=stage){return campaignSourceStages[campaignStage(number)-1]}
function skyTex(t){const W=t.stars?256:4,c=document.createElement('canvas');c.width=W;c.height=128;const g=c.getContext('2d');const gr=g.createLinearGradient(0,0,0,128);gr.addColorStop(0,t.top);gr.addColorStop(0.55,t.hor);gr.addColorStop(1,t.hor);g.fillStyle=gr;g.fillRect(0,0,W,128);
  if(t.stars){for(let i=0;i<160;i++){g.fillStyle=`rgba(255,255,255,${Math.random()*0.8+0.2})`;g.fillRect(Math.random()*W|0,Math.random()*60|0,1,1)}}const tx=new THREE.CanvasTexture(c);tx.magFilter=THREE.NearestFilter;return tx}
function groundTex(spec,seed){
  const[kind,c0,c1,c2]=spec;if(kind==='city')return citySurface();const c=document.createElement('canvas');c.width=c.height=32;const g=c.getContext('2d'),r=mulberry(seed);
  g.fillStyle=c0;g.fillRect(0,0,32,32);
  if(kind==='sea'){for(let i=0;i<16;i++){g.fillStyle=c2;g.fillRect(r()*32|0,r()*32|0,2+(r()*3|0),1)}for(let i=0;i<10;i++){g.fillStyle=c1;g.fillRect(r()*32|0,r()*32|0,1+(r()*3|0),1)}}
  else if(kind==='grass'){for(let i=0;i<40;i++){g.fillStyle=r()<0.5?c1:c2;g.fillRect(r()*32|0,r()*32|0,1+(r()*2|0),1+(r()*2|0))}for(let i=0;i<3;i++){g.fillStyle=r()<0.5?'#f0e070':'#f0a0c0';g.fillRect(r()*32|0,r()*32|0,1,1)}}
  else if(kind==='fields'){g.fillStyle=c1;g.fillRect(0,0,16,16);g.fillStyle=c2;g.fillRect(16,16,16,16);g.fillStyle='#7a9a3a';g.fillRect(16,0,16,16);
    for(let y=0;y<32;y+=2){g.fillStyle='rgba(0,0,0,.08)';g.fillRect(0,y,32,1)}g.fillStyle='#b89a68';g.fillRect(0,15,32,2);g.fillRect(15,0,2,32)}
  else if(kind==='desert'){for(let i=0;i<50;i++){g.fillStyle=r()<0.5?c1:c2;g.fillRect(r()*32|0,r()*32|0,1+(r()*3|0),1)}g.fillStyle='rgba(0,0,0,.06)';for(let y=0;y<32;y+=4)g.fillRect(0,y,32,1)}
  else if(kind==='cloud'){for(let i=0;i<9;i++){const x=r()*32,y=r()*32,rr=3+r()*5;g.fillStyle=c2;g.beginPath();g.arc(x+1,y+1.5,rr,0,7);g.fill();g.fillStyle=c1;g.beginPath();g.arc(x,y,rr,0,7);g.fill()}}
  else if(kind==='city'){g.fillStyle=c1;g.fillRect(0,0,32,4);g.fillRect(0,0,4,32);g.fillStyle=c2;for(let i=6;i<32;i+=6)g.fillRect(i,1,3,1);for(let i=6;i<32;i+=6)g.fillRect(1,i,1,3);
    g.fillStyle='rgba(255,255,255,.07)';for(let i=0;i<14;i++)g.fillRect(6+(r()*24|0),6+(r()*24|0),2,2)}
  else{g.fillStyle=c2;for(let i=0;i<32;i+=8){g.fillRect(i,0,1,32);g.fillRect(0,i,32,1)}g.fillStyle=c1;for(let i=0;i<14;i++)g.fillRect(r()*32|0,r()*32|0,1,1);g.fillStyle='#ffd070';for(let i=0;i<3;i++)g.fillRect(r()*32|0,r()*32|0,1,1)}
  const t=new THREE.CanvasTexture(c);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestMipMapNearestFilter;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3200/(kind==='fields'||kind==='city'?48:16),3200/(kind==='fields'||kind==='city'?48:16));return t;
}
const ground=new THREE.Mesh(new THREE.PlaneGeometry(3200,3200),new THREE.MeshStandardMaterial({color:0xc2c7cb,roughness:.55,metalness:.20}));ground.receiveShadow=true;ground.rotation.x=-Math.PI/2;scene.add(ground);
const river=new THREE.Mesh(new THREE.PlaneGeometry(130,3200),new THREE.MeshBasicMaterial({color:0xffffff}));river.rotation.x=-Math.PI/2;river.position.y=0.15;scene.add(river);
const riverTex=groundTex(['sea','#3a8ac0','#8ad0f0','#2a70a0'],5);riverTex.repeat.set(130/16,3200/16);river.material.map=riverTex;
let groundFrames=[],curTheme=THEMES[0],gridStep=16;
function applyTheme(t){
  if(scene.background?.isTexture)scene.background.dispose();for(const frame of groundFrames)frame?.dispose();curTheme=t;scene.background=skyTex(t);scene.fog=new THREE.Fog(t.fog,240,1050);
  groundFrames=[groundTex(t.ground,11),t.ground[0]==='sea'?groundTex(t.ground,23):null];gridStep=(t.ground[0]==='fields'||t.ground[0]==='city')?48:16;
  ground.material.map=groundFrames[0];ground.material.needsUpdate=true;river.visible=t.kind==='river';ground.position.y=(t.kind==='sky'||t.kind==='strato')?-16:0;shadow.material.opacity=(t.kind==='sky'||t.kind==='strato')?0:0.28;
  if(t.kind==='city'){scene.fog=new THREE.FogExp2(0xaa9da6,.00195);gridStep=96;}scene.fog.color.convertSRGBToLinear();
  ground.material.roughness=t.kind==='sea'?.32:t.kind==='city'?.79:.86;
  ground.material.metalness=t.kind==='sea'?.33:t.kind==='city'?.08:.04;
  for(const map of groundFrames)if(map)map.encoding=THREE.sRGBEncoding;
  applyWorldMaterials(t);setStageWeather();flightWater.setStage(t);pMat.uniforms.fogColor.value.copy(scene.fog.color);
}

/* =====================================================================
   파티클
   ===================================================================== */
const PN=9500;
const pPos=new Float32Array(PN*3),pCol=new Float32Array(PN*3),pSize=new Float32Array(PN),pAlpha=new Float32Array(PN);
const parts=[];for(let i=0;i<PN;i++)parts.push({l:0,m:1,x:0,y:0,z:0,vx:0,vy:0,vz:0,k:0,s0:1,s1:1,dr:0,r:1,g:1,b:1});
const pGeo=new THREE.BufferGeometry();
pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));pGeo.setAttribute('pcol',new THREE.BufferAttribute(pCol,3));
pGeo.setAttribute('psize',new THREE.BufferAttribute(pSize,1));pGeo.setAttribute('palpha',new THREE.BufferAttribute(pAlpha,1));
const pMat=new THREE.ShaderMaterial({
  uniforms:{scale:{value:300},fogColor:{value:new THREE.Color(0xffffff)},fogNear:{value:240},fogFar:{value:1050}},
  vertexShader:`attribute vec3 pcol;attribute float psize;attribute float palpha;uniform float scale;uniform float fogNear;uniform float fogFar;varying vec3 vC;varying float vA;varying float vF;
    void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;float d=max(1.0,-mv.z);gl_PointSize=clamp(psize*scale/d,1.0,90.0);vC=pcol;vA=palpha;vF=smoothstep(fogNear,fogFar,d);}`,
  fragmentShader:`uniform vec3 fogColor;varying vec3 vC;varying float vA;varying float vF;void main(){if(vA<0.02)discard;float r=length(gl_PointCoord-.5)*2.;if(r>=1.)discard;gl_FragColor=vec4(mix(vC,fogColor,vF),vA*(1.-smoothstep(.18,1.,r)));}`,
  transparent:true,depthWrite:false});
const pts=new THREE.Points(pGeo,pMat);pts.frustumCulled=false;scene.add(pts);
let pi=0;
function emit(k,x,y,z,vx,vy,vz,l,s0,s1,dr=1.2,c){const q=parts[pi];pi=(pi+1)%PN;q.k=k;q.x=x;q.y=y;q.z=z;q.vx=vx;q.vy=vy;q.vz=vz;q.l=q.m=l;q.s0=s0;q.s1=s1;q.dr=dr;if(c){q.r=c[0];q.g=c[1];q.b=c[2]}else{q.r=q.g=q.b=1}}
const RAMP=[[1,1,.75],[1,.68,.18],[.92,.3,.1],[.4,.36,.38]];
function updParts(dt){
  for(let i=0;i<PN;i++){const q=parts[i],j=i*3;if(q.l<=0){pAlpha[i]=0;continue}
    q.l-=dt;const f=Math.max(0,1-q.dr*dt);q.vx*=f;q.vy*=f;q.vz*=f;if(q.k===3)q.vy-=80*dt;if(q.k===1){const drift=(1-q.l/q.m)*dt*.68;q.x+=flightWeather.windX*drift;q.z+=flightWeather.windZ*drift;}q.x+=q.vx*dt;q.y+=q.vy*dt;q.z+=q.vz*dt;
    const t=clamp(1-q.l/q.m,0,1);let r,g,b,a;
    if(q.k===0){const c=RAMP[Math.min(3,t*4|0)];r=c[0];g=c[1];b=c[2];a=t<0.7?1:(1-t)/0.3}
    else if(q.k===1){const s=1-0.3*t;r=q.r*s;g=q.g*s;b=q.b*s;a=(1-t)*0.85}
    else if(q.k===2){r=1;g=.96;b=.6;a=1-t}else if(q.k===3){r=q.r;g=q.g;b=q.b;a=t<0.8?1:(1-t)*5}else{r=g=b=1;a=0.5*(1-t)}
    pPos[j]=q.x;pPos[j+1]=q.y;pPos[j+2]=q.z;pCol[j]=r;pCol[j+1]=g;pCol[j+2]=b;pSize[i]=lerp(q.s0,q.s1,t);pAlpha[i]=q.l>0?a:0}
  pGeo.attributes.position.needsUpdate=true;pGeo.attributes.pcol.needsUpdate=true;pGeo.attributes.psize.needsUpdate=true;pGeo.attributes.palpha.needsUpdate=true;
}
function explode(p,size){
  flashExplosion(p,size);impactFront(p,size);
  const n=Math.round(5*size);emit(0,p.x,p.y,p.z,0,0,-speed*0.5,0.16,4*size,6*size,0);
  for(let i=0;i<n;i++){const a=rnd(0,6.28),b=rnd(-1,1),s=rnd(15,45)*Math.sqrt(size),sq=Math.sqrt(1-b*b);emit(0,p.x,p.y,p.z,Math.cos(a)*sq*s,b*s+6,Math.sin(a)*sq*s-speed*0.55,rnd(0.45,0.9)+size*0.06,rnd(1.8,3)*Math.sqrt(size),rnd(0.8,1.5),1.6)}
  for(let i=0;i<n*0.6;i++)emit(1,p.x+rnd(-2,2)*size,p.y+rnd(-2,2)*size,p.z+rnd(-2,2)*size,rnd(-6,6),rnd(2,10),-speed*0.5,rnd(1,1.8),2*Math.sqrt(size),6*Math.sqrt(size),1.2,[.5,.48,.5]);
  for(let i=0;i<n*0.5;i++){const a=rnd(0,6.28),s=rnd(25,60);emit(3,p.x,p.y,p.z,Math.cos(a)*s,rnd(10,50),Math.sin(a)*s-speed*0.5,rnd(0.8,1.4),0.8,0.8,0.6,[.25,.24,.28])}
  for(let i=0;i<n*0.8;i++){const a=rnd(0,6.28),b=rnd(-1,1),s=rnd(50,110),sq=Math.sqrt(1-b*b);emit(2,p.x,p.y,p.z,Math.cos(a)*sq*s,b*s,Math.sin(a)*sq*s-speed*0.5,rnd(0.2,0.4),0.9,0.9,2)}
  shake=Math.max(shake,0.08*size);SFX.boom(size,p);
}

/* =====================================================================
   투사체 인스턴스
   ===================================================================== */
const BMAX=700,dummy=new THREE.Object3D();
function inst(geo,col,n=BMAX){const m=new THREE.InstancedMesh(geo,new THREE.MeshBasicMaterial({color:col}),n);m.frustumCulled=false;m.count=0;scene.add(m);return m}
const pBulM=inst(new THREE.SphereGeometry(1,8,6).scale(.32,.32,5),0xffedab),eOrbM=inst(new THREE.SphereGeometry(1.3,12,8),0xff522e),eOrbCore=inst(new THREE.SphereGeometry(.89,10,6),0xffe0ac);
const mslM=inst(new THREE.BoxGeometry(1,1,4.5),0xffffff,260),emslM=inst(new THREE.BoxGeometry(1.6,1.6,4),0xff8a3a,80);
pBulM.material.color.setRGB(3.4,2.36,.74);eOrbM.material.color.setRGB(2.9,.26,.055);
const shadow=new THREE.Mesh(new THREE.CircleGeometry(5,12),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.28,depthWrite:false}));shadow.rotation.x=-Math.PI/2;scene.add(shadow);
const ITEM_DEF={P:{c:'#ff5a3a',t:'P'},M:{c:'#3a8aff',t:'M'},S:{c:'#18b8c8',t:'S'},R:{c:'#a05ae0',t:'R'},H:{c:'#2fc35a',t:'H'},STAR:{c:'#ffc21a',t:'★'}},ITEM_MAT={};
for(const k in ITEM_DEF){const d=ITEM_DEF[k],c=document.createElement('canvas');c.width=c.height=16;const g=c.getContext('2d');
  g.fillStyle='#fff';g.beginPath();g.arc(8,8,7.5,0,7);g.fill();g.fillStyle=d.c;g.beginPath();g.arc(8,8,6,0,7);g.fill();g.fillStyle='#fff';g.font='bold 10px monospace';g.textAlign='center';g.textBaseline='middle';g.fillText(d.t,8,8.5);
  const t=new THREE.CanvasTexture(c);t.magFilter=t.minFilter=THREE.NearestFilter;ITEM_MAT[k]=new THREE.SpriteMaterial({map:t,transparent:true})}

/* =====================================================================
   PSG 사운드
   ===================================================================== */
const AU={ctx:null,on:store.get('snd',true)};
const sampleFiles={"shot": "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jCWl1mKstZSUWoy1FgAAUOAAABBgg6bE4gCFhqwEAKIAABBjEGIMQoOMUoxBaAxSijkIkVKMOSclUoox56RkjjknIaWMOeeglBRCKCWllkIIpaSUWgEAAAUOAAABNmhKLA5QaMiKACAKAAAwBjGGGEPQMSmdlMhBJiWT0DgHKXWUMkqlxBJjRqnEVmKMoHOUQkoZpRJjaTGjVGIMsRQAAHbgAAB2YCEUGrISAMgDAECMUYox55wzCDHlnHPOGYQUc8455xRjjDnnnHOKMcacc8455pxzzkEIIXPOOecghNA55xyEEELonHMOQgghdM45ByGEEDrnnIMQQggFAAAVOAAABNgosjnBSFChISsBgDwAAMAYpZyDUEqjFGMQSkmpUYoxCKWkVDkHoZSUWqucg1BKSq11EEpJqbUYOwilpNRajKWUlGKMMddQSkstxlhzai3GGHPNOaUWY60151wAAO6CAwDYgY0imxOMBBUashIAyAMAQBBSijHGGEMKMcaYY84hpBRjjDHnFGOMOeacc0oxxphzzjnGmHPOOeccY4w555xzjjHmnHPOOcecc84555xjzjnnnHPOMeecc8455wQAABU4AAAE2CiyOcFIUKEhKwGAcAAAgAjoOOecc845Nw5irbXWWmutNXJQa6211lprranWWmuttdZaa0211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaAJBvhQOA/4ONM6wknRWOBhcashIACAcAAIxhzEHnoIMOQsOUcxBCCCGEEBqmIJQSQimlpJRBJyWlUlJKKaXMQSkplZJSSql1UlJqLaXWWoutk5JSSyml1lqLHYRUUmqttdhi6yCklFJrrbUYYygltdZaizHGGEMpKbXWWowx1lhKaam1GGOMMcZSUkqtxRhjjDGWlFqLrcUYY4y1pNRabDHGGmONBQBwNzgAQCTYOMNK0lnhaHChISsBgJAAAAQhxpxzzjnoHIQQKcWYc845ByGEECKlGHPOOecghBBCxphzzkEIIYQQQsgYc845CCGEEEIInXPOQQghhBBCCKFzzjkIIYQQQgghdM5BCCGEEEIIIYTOOQghhBBCCCGE0EEI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", "launch": "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jCWl1mKstZSUWoy1FgAAUOAAABBgg6bE4gCFhqwEAKIAABBjEGIMQoOMUoxBaAxSijkIkVKMOSclUoox56RkjjknIaWMOeeglBRCKCWllkIIpaSUWgEAAAUOAAABNmhKLA5QaMiKACAKAAAwBjGGGEPQMSmdlMhBJiWT0DgHKXWUMkqlxBJjRqnEVmKMoHOUQkoZpRJjaTGjVGIMsRQAAHbgAAB2YCEUGrISAMgDAECMUYox55wzCDHlnHPOGYQUc8455xRjjDnnnHOKMcacc8455pxzzkEIIXPOOecghNA55xyEEELonHMOQgghdM45ByGEEDrnnIMQQggFAAAVOAAABNgosjnBSFChISsBgDwAAMAYpZyDUEqjFGMQSkmpUYoxCKWkVDkHoZSUWqucg1BKSq11EEpJqbUYOwilpNRajKWUlGKMMddQSkstxlhzai3GGHPNOaUWY60151wAAO6CAwDYgY0imxOMBBUashIAyAMAQBBSijHGGEMKMcaYY84hpBRjjDHnFGOMOeacc0oxxphzzjnGmHPOOeccY4w555xzjjHmnHPOOcecc84555xjzjnnnHPOMeecc8455wQAABU4AAAE2CiyOcFIUKEhKwGAcAAAgAjoOOecc845Nw5irbXWWmutNXJQa6211lprranWWmuttdZaa0211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaAJBvhQOA/4ONM6wknRWOBhcashIACAcAAIxhzEHnoIMOQsOUcxBCCCGEEBqmIJQSQimlpJRBJyWlUlJKKaXMQSkplZJSSql1UlJqLaXWWoutk5JSSyml1lqLHYRUUmqttdhi6yCklFJrrbUYYygltdZaizHGGEMpKbXWWowx1lhKaam1GGOMMcZSUkqtxRhjjDGWlFqLrcUYY4y1pNRabDHGGmONBQBwNzgAQCTYOMNK0lnhaHChISsBgJAAAAQhxpxzzjnoHIQQKcWYc845ByGEECKlGHPOOecghBBCxphzzkEIIYQQQsgYc845CCGEEEIInXPOQQghhBBCCKFzzjkIIYQQQgghdM5BCCGEEEIIIYTOOQghhBBCCCGE0EEI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", "boom": "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jCWl1mKstZSUWoy1FgAAUOAAABBgg6bE4gCFhqwEAKIAABBjEGIMQoOMUoxBaAxSijkIkVKMOSclUoox56RkjjknIaWMOeeglBRCKCWllkIIpaSUWgEAAAUOAAABNmhKLA5QaMiKACAKAAAwBjGGGEPQMSmdlMhBJiWT0DgHKXWUMkqlxBJjRqnEVmKMoHOUQkoZpRJjaTGjVGIMsRQAAHbgAAB2YCEUGrISAMgDAECMUYox55wzCDHlnHPOGYQUc8455xRjjDnnnHOKMcacc8455pxzzkEIIXPOOecghNA55xyEEELonHMOQgghdM45ByGEEDrnnIMQQggFAAAVOAAABNgosjnBSFChISsBgDwAAMAYpZyDUEqjFGMQSkmpUYoxCKWkVDkHoZSUWqucg1BKSq11EEpJqbUYOwilpNRajKWUlGKMMddQSkstxlhzai3GGHPNOaUWY60151wAAO6CAwDYgY0imxOMBBUashIAyAMAQBBSijHGGEMKMcaYY84hpBRjjDHnFGOMOeacc0oxxphzzjnGmHPOOeccY4w555xzjjHmnHPOOcecc84555xjzjnnnHPOMeecc8455wQAABU4AAAE2CiyOcFIUKEhKwGAcAAAgAjoOOecc845Nw5irbXWWmutNXJQa6211lprranWWmuttdZaa0211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaAJBvhQOA/4ONM6wknRWOBhcashIACAcAAIxhzEHnoIMOQsOUcxBCCCGEEBqmIJQSQimlpJRBJyWlUlJKKaXMQSkplZJSSql1UlJqLaXWWoutk5JSSyml1lqLHYRUUmqttdhi6yCklFJrrbUYYygltdZaizHGGEMpKbXWWowx1lhKaam1GGOMMcZSUkqtxRhjjDGWlFqLrcUYY4y1pNRabDHGGmONBQBwNzgAQCTYOMNK0lnhaHChISsBgJAAAAQhxpxzzjnoHIQQKcWYc845ByGEECKlGHPOOecghBBCxphzzkEIIYQQQsgYc845CCGEEEIInXPOQQghhBBCCKFzzjkIIYQQQgghdM5BCCGEEEIIIYTOOQghhBBCCCGE0EEI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", "burner": "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jCWl1mKstZSUWoy1FgAAUOAAABBgg6bE4gCFhqwEAKIAABBjEGIMQoOMUoxBaAxSijkIkVKMOSclUoox56RkjjknIaWMOeeglBRCKCWllkIIpaSUWgEAAAUOAAABNmhKLA5QaMiKACAKAAAwBjGGGEPQMSmdlMhBJiWT0DgHKXWUMkqlxBJjRqnEVmKMoHOUQkoZpRJjaTGjVGIMsRQAAHbgAAB2YCEUGrISAMgDAECMUYox55wzCDHlnHPOGYQUc8455xRjjDnnnHOKMcacc8455pxzzkEIIXPOOecghNA55xyEEELonHMOQgghdM45ByGEEDrnnIMQQggFAAAVOAAABNgosjnBSFChISsBgDwAAMAYpZyDUEqjFGMQSkmpUYoxCKWkVDkHoZSUWqucg1BKSq11EEpJqbUYOwilpNRajKWUlGKMMddQSkstxlhzai3GGHPNOaUWY60151wAAO6CAwDYgY0imxOMBBUashIAyAMAQBBSijHGGEMKMcaYY84hpBRjjDHnFGOMOeacc0oxxphzzjnGmHPOOeccY4w555xzjjHmnHPOOcecc84555xjzjnnnHPOMeecc8455wQAABU4AAAE2CiyOcFIUKEhKwGAcAAAgAjoOOecc845Nw5irbXWWmutNXJQa6211lprranWWmuttdZaa0211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaAJBvhQOA/4ONM6wknRWOBhcashIACAcAAIxhzEHnoIMOQsOUcxBCCCGEEBqmIJQSQimlpJRBJyWlUlJKKaXMQSkplZJSSql1UlJqLaXWWoutk5JSSyml1lqLHYRUUmqttdhi6yCklFJrrbUYYygltdZaizHGGEMpKbXWWowx1lhKaam1GGOMMcZSUkqtxRhjjDGWlFqLrcUYY4y1pNRabDHGGmONBQBwNzgAQCTYOMNK0lnhaHChISsBgJAAAAQhxpxzzjnoHIQQKcWYc845ByGEECKlGHPOOecghBBCxphzzkEIIYQQQsgYc845CCGEEEIInXPOQQghhBBCCKFzzjkIIYQQQgghdM5BCCGEEEIIIYTOOQghhBBCCCGE0EEI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", "sonic": "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jCWl1mKstZSUWoy1FgAAUOAAABBgg6bE4gCFhqwEAKIAABBjEGIMQoOMUoxBaAxSijkIkVKMOSclUoox56RkjjknIaWMOeeglBRCKCWllkIIpaSUWgEAAAUOAAABNmhKLA5QaMiKACAKAAAwBjGGGEPQMSmdlMhBJiWT0DgHKXWUMkqlxBJjRqnEVmKMoHOUQkoZpRJjaTGjVGIMsRQAAHbgAAB2YCEUGrISAMgDAECMUYox55wzCDHlnHPOGYQUc8455xRjjDnnnHOKMcacc8455pxzzkEIIXPOOecghNA55xyEEELonHMOQgghdM45ByGEEDrnnIMQQggFAAAVOAAABNgosjnBSFChISsBgDwAAMAYpZyDUEqjFGMQSkmpUYoxCKWkVDkHoZSUWqucg1BKSq11EEpJqbUYOwilpNRajKWUlGKMMddQSkstxlhzai3GGHPNOaUWY60151wAAO6CAwDYgY0imxOMBBUashIAyAMAQBBSijHGGEMKMcaYY84hpBRjjDHnFGOMOeacc0oxxphzzjnGmHPOOeccY4w555xzjjHmnHPOOcecc84555xjzjnnnHPOMeecc8455wQAABU4AAAE2CiyOcFIUKEhKwGAcAAAgAjoOOecc845Nw5irbXWWmutNXJQa6211lprranWWmuttdZaa0211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaAJBvhQOA/4ONM6wknRWOBhcashIACAcAAIxhzEHnoIMOQsOUcxBCCCGEEBqmIJQSQimlpJRBJyWlUlJKKaXMQSkplZJSSql1UlJqLaXWWoutk5JSSyml1lqLHYRUUmqttdhi6yCklFJrrbUYYygltdZaizHGGEMpKbXWWowx1lhKaam1GGOMMcZSUkqtxRhjjDGWlFqLrcUYY4y1pNRabDHGGmONBQBwNzgAQCTYOMNK0lnhaHChISsBgJAAAAQhxpxzzjnoHIQQKcWYc845ByGEECKlGHPOOecghBBCxphzzkEIIYQQQsgYc845CCGEEEIInXPOQQghhBBCCKFzzjkIIYQQQgghdM5BCCGEEEIIIYTOOQghhBBCCCGE0EEI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"},flightBuffers=new Map(),voices=[];
function loadFlightAudio(ctx){
  for(const [name,data] of Object.entries(sampleFiles)){
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    ctx.decodeAudioData(bytes.buffer).then(b=>flightBuffers.set(name,b)).catch(()=>{});
  }
}
function playFlightSample(name,volume=1,rate=1,delay=0){
  const buffer=flightBuffers.get(name),c=AU.ctx;
  if(!buffer||!c||!AU.on)return false;
  const start=c.currentTime+delay,g=c.createGain(),src=c.createBufferSource();
  const duration=name==='shot'?Math.min(.17,buffer.duration):buffer.duration;
  src.buffer=buffer;src.playbackRate.value=rate;g.gain.setValueAtTime(volume,start);
  const end=start+duration/rate;
  g.gain.setValueAtTime(volume,Math.max(start,end-.035));g.gain.linearRampToValueAtTime(0,end);
  src.connect(g);g.connect(AU.sfx);
  while(voices.length>=20){const oldest=voices.shift();try{oldest.stop();}catch{}}
  voices.push(src);src.onended=()=>{src.disconnect();g.disconnect();const i=voices.indexOf(src);if(i>=0)voices.splice(i,1);};
  src.start(start,0,duration);return true;
}

function audioInit(){
  if(audioExited||audioAway)return;
  if(AU.ctx){if(AU.ctx.state==='suspended')AU.ctx.resume();return}
  try{const c=new(window.AudioContext||window.webkitAudioContext)();AU.ctx=c;
    AU.master=c.createGain();AU.master.gain.value=AU.on?0.8:0;AU.master.connect(c.destination);
    AU.sfx=c.createGain();AU.sfx.gain.value=0.5;AU.sfx.connect(AU.master);
    AU.wave={};for(const d of[0.125,0.25,0.5]){const n=48,re=new Float32Array(n),im=new Float32Array(n);for(let k=1;k<n;k++)re[k]=2*Math.sin(k*Math.PI*d)/(k*Math.PI);AU.wave[d]=c.createPeriodicWave(re,im)}
    const nb=c.createBuffer(1,c.sampleRate,c.sampleRate),d=nb.getChannelData(0);let v=0;for(let i=0;i<d.length;i++){if(i%3===0)v=Math.random()<0.5?-1:1;d[i]=v*0.8}AU.noise=nb;loadFlightAudio(c);
  }catch(e){AU.ctx=null}
}
const mtof=m=>440*Math.pow(2,(m-69)/12);
function pulse(t,f,dur,vol,duty,dest,f2){const c=AU.ctx,o=c.createOscillator(),g=c.createGain();o.setPeriodicWave(AU.wave[duty]||AU.wave[0.5]);o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
  g.gain.setValueAtTime(0.0001,t);g.gain.linearRampToValueAtTime(vol,t+0.004);g.gain.linearRampToValueAtTime(vol*0.6,t+dur*0.8);g.gain.linearRampToValueAtTime(0.0001,t+dur);o.connect(g);g.connect(dest);o.start(t);o.stop(t+dur+0.03)}
function tri(t,f,dur,vol,dest,f2){const c=AU.ctx,o=c.createOscillator(),g=c.createGain();o.type='triangle';o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
  g.gain.setValueAtTime(0.0001,t);g.gain.linearRampToValueAtTime(vol,t+0.004);g.gain.setValueAtTime(vol,t+dur*0.85);g.gain.linearRampToValueAtTime(0.0001,t+dur);o.connect(g);g.connect(dest);o.start(t);o.stop(t+dur+0.03)}
function nz(t,dur,vol,type,f0,f1,dest){const c=AU.ctx,s=c.createBufferSource(),fl=c.createBiquadFilter(),g=c.createGain();s.buffer=AU.noise;s.loop=true;fl.type=type;fl.frequency.setValueAtTime(f0,t);if(f1)fl.frequency.exponentialRampToValueAtTime(f1,t+dur);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);s.connect(fl);fl.connect(g);g.connect(dest);s.start(t,Math.random()*0.8);s.stop(t+dur+0.03)}
const musicPlayer = document.getElementById('game-music');
const musicFiles = {"flight-01":"assets/music/flight-01-437126a780ee3b6d.mp3","flight-02":"assets/music/flight-02-1e914e887ad47104.mp3","narrative":"assets/music/narrative-1dcd89dfc3f5b582.mp3","ending":"assets/music/ending-1bd5d861a9039bd7.mp3"};
const musicUrls = new Map();
const flightTracks = ['flight-01','flight-02'];
const flightLeadIn = {'flight-01':0.37, 'flight-02':0.61};
let titleTrack = flightTracks[0];
let sortieIndex = 0;
let musicScene = '', musicTrack = '';

let audioExited=false, audioAway=document.hidden, resumeMusic=false, resumeFilm=false;
function syncGameMute(){
  const muted=audioExited||audioAway||!AU.on;
  if(muted)silenceTargetTones();
  musicPlayer.muted=muted;
  if(AU.master)AU.master.gain.value=muted?0:.8;
  const film=document.getElementById('opening-film');
  if(film)film.muted=muted;document.getElementById('victory-film').muted=muted;
}
function silenceGameAudio(exiting=false){
  if(exiting){
    audioExited=true;
    closeVictoryFilm();document.body.classList.remove('cine');
    resumeMusic=resumeFilm=false;
    afterOpening=null;closeFilmLayer();
  }else{
    if(audioExited||audioAway)return;
    audioAway=true;
    resumeMusic=!musicPlayer.paused&&!musicPlayer.ended;
    resumeFilm=!!afterOpening;
  }
  syncGameMute();
  musicPlayer.pause();
  const film=document.getElementById('opening-film');
  if(film)film.pause();if(victoryActive){victoryPlayback++;victoryVideo.pause();}
}
function restoreGameAudio(){
  if(document.hidden||audioExited||!audioAway)return;
  audioAway=false;syncGameMute();resumeVictoryFilm();
  const restartMusic=resumeMusic,restartFilm=resumeFilm;
  resumeMusic=resumeFilm=false;
  if(restartMusic&&musicScene)musicPlayer.play().catch(()=>{});

  if(restartFilm&&afterOpening){
    if(openingVideo.ended)finishOpening({type:'ended'});
    else openingVideo.play().catch(()=>{});
  }
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)silenceGameAudio();else restoreGameAudio();});
window.addEventListener('pagehide',()=>silenceGameAudio());
window.addEventListener('pageshow',restoreGameAudio);

musicPlayer.volume = .62;
musicPlayer.muted = !AU.on;

const musicPrefetches=new Set();
function musicUrl(track) {
  return musicUrls.get(track) || musicFiles[track];
}
function warmMusic(track) {
  if(musicPrefetches.has(track)||location.protocol==='file:')return;
  musicPrefetches.add(track);
  fetch(musicFiles[track],{cache:'force-cache'}).then(response=>{
    if(!response.ok)throw Error(response.status);
    return response.blob();
  }).then(blob=>musicUrls.set(track,URL.createObjectURL(blob))).catch(()=>{
    // Streaming directly is still available when prefetch is interrupted.
  });
}

function cueMusic(scene,track,startTime=0,restart=false) {
  if (audioExited||!AU.ctx) return;
  const changed = musicTrack!==track;
  const betweenFlightTracks=changed&&flightTracks.includes(musicTrack)&&flightTracks.includes(track);
  // A null start time transfers the current stream without flushing the media decoder.
  const seek = changed || restart || (startTime!==null && scene!==musicScene);
  musicScene=scene;musicTrack=track;
  musicPlayer.loop=scene==='story'||scene==='ending';
  if (changed) musicPlayer.src=musicUrl(track);
  // At a playlist boundary skip only the measured silent lead-in of the supplied MP3.
  if (seek) musicPlayer.currentTime=betweenFlightTracks ? flightLeadIn[track] : (startTime??0);
  if(audioAway){resumeMusic=true;return;}
  if (musicPlayer.paused) {
    // A source change can cancel the preceding play request. A later user input can retry.
    musicPlayer.play().catch(error=>{
      if(error.name!=='AbortError' && error.name!=='NotAllowedError')console.warn('Music playback',error);
    });
  }
}

function playOpeningMusic() {
  const current=flightTracks.indexOf(musicTrack);
  const continuous=current>=0&&(musicScene==='title'||musicScene==='opening'||musicScene==='flight');
  if(continuous)titleTrack=musicPlayer.ended?flightTracks[1-current]:musicTrack;
  cueMusic('opening',titleTrack,continuous?null:0);
}

function playCampaignMusic() {
  const activeIndex=flightTracks.indexOf(musicTrack);
  if(activeIndex>=0&&(musicScene==='opening'||musicScene==='title'||musicScene==='flight')){
    // All campaign screens use the same running playlist and media clock.
    sortieIndex=musicPlayer.ended?1-activeIndex:activeIndex;
    cueMusic('flight',flightTracks[sortieIndex],null);
  }else{
    // CONTINUE begins a new campaign playlist; it always starts with track 01.
    sortieIndex=0;
    cueMusic('flight',flightTracks[0],0);
  }
}

function playSong(cue) {
  if(cue==='over'){
    cueMusic('ending','ending');
  }else if(cue==='opening'){
    if(musicScene==='opening'||musicScene==='flight')titleTrack=musicTrack;
    cueMusic('title',titleTrack,musicTrack===titleTrack?null:0);
  }else if(cue==='story'){
    cueMusic('story','narrative');
  }else{
    playCampaignMusic();
  }
}

function stopSong() {
  resumeMusic=false;musicPlayer.pause();musicScene='';
}

musicPlayer.addEventListener('timeupdate',()=>{
  const i=flightTracks.indexOf(musicTrack);
  if(i>=0&&!musicPlayer.paused&&musicPlayer.currentTime>5)warmMusic(flightTracks[1-i]);
});

musicPlayer.addEventListener('ended',()=>{
  if(!musicPlayer.ended)return;
  if(musicScene==='flight') {
    sortieIndex=1-sortieIndex;
    cueMusic('flight',flightTracks[sortieIndex]);
  } else if(musicScene==='title'||musicScene==='opening') {
    titleTrack=flightTracks[1-flightTracks.indexOf(titleTrack)];
    cueMusic(musicScene,titleTrack);
  }
});

let lastShotSnd=0,lastHitSnd=0;

// Render the four-note lock chime once. At high lock rates the phrases queue on
// the audio clock, so consecutive contacts remain distinct on slow frames too.
let targetToneBuffer=null, targetToneBus=null, targetToneTail=0;
function targetToneOutput(){
  if(!targetToneBus){
    targetToneBus=AU.ctx.createGain();
    targetToneBus.connect(AU.sfx);
  }
  return targetToneBus;
}
function silenceTargetTones(){
  if(targetToneBus){
    targetToneBus.disconnect();
    targetToneBus=null;
  }
  targetToneTail=0;
}
function acquiredTargetTone(){
  if(!AU.ctx||!AU.on||audioExited||audioAway||paused||state!=='play')return;
  const ctx=AU.ctx;
  if(!targetToneBuffer){
    const sampleRate=ctx.sampleRate;
    targetToneBuffer=ctx.createBuffer(1,Math.ceil(sampleRate*.106),sampleRate);
    const pcm=targetToneBuffer.getChannelData(0);
    // A bright pickup, two short steps, and a bell-like octave.
    const notes=[[0,.024,1046.5,.23],[.025,.016,1318.5,.20],[.042,.016,1568,.22],[.059,.046,2093,.27]];
    for(const [offset,duration,hz,level] of notes){
      const first=Math.round(offset*sampleRate),count=Math.floor(duration*sampleRate);
      for(let i=0;i<count;i++){
        const t=i/sampleRate,phase=2*Math.PI*hz*t;
        const envelope=Math.min(1,t/.0025)*Math.min(1,(duration-t)/.005)*Math.exp(-1.6*t/duration);
        pcm[first+i]=level*envelope*(Math.sin(phase)+.24*Math.sin(2*phase)+.12*Math.sin(3*phase));
      }
    }
  }
  const now=ctx.currentTime,start=Math.max(now+.003,targetToneTail);
  const rate=1+Math.min(.38,(start-now)*1.8);
  const voice=ctx.createBufferSource();
  voice.buffer=targetToneBuffer;voice.playbackRate.value=rate;
  voice.connect(targetToneOutput());voice.onended=()=>voice.disconnect();
  voice.start(start);
  targetToneTail=start+targetToneBuffer.duration/rate+.003;
}

const SFX={ok:()=>AU.ctx&&AU.on,
  shot(){if(!this.ok())return;const t=AU.ctx.currentTime;if(t-lastShotSnd<0.07)return;lastShotSnd=t;if(playFlightSample('shot',.37,1))return;pulse(t,1900,0.05,0.07,.125,AU.sfx,700)},
  hit(){if(!this.ok())return;const t=AU.ctx.currentTime;if(t-lastHitSnd<0.05)return;lastHitSnd=t;nz(t,0.05,0.25,'bandpass',3500,1500,AU.sfx);pulse(t,420,0.04,0.06,.5,AU.sfx,200)},
  boom(s,p){if(!this.ok())return;const t=AU.ctx.currentTime,d=p?clamp(1-p.distanceTo(ppos)/900,0.15,1):1;if(playFlightSample('boom',Math.min(.84,.27+s*.09)*d,Math.max(.76,1.10-s*.055)))return;nz(t,0.25+s*0.1,0.42*d,'lowpass',s>3?1400:2600,90,AU.sfx);tri(t,s>3?120:200,0.22+s*0.06,0.3*d,AU.sfx,35)},
  lock:acquiredTargetTone,
  launch(n){if(!this.ok())return;if(playFlightSample('launch',.62)){if(n>=4)playFlightSample('launch',.23,1.16,.12);return;}const t=AU.ctx.currentTime;for(let i=0;i<Math.min(n,12);i++){nz(t+i*0.03,0.25,0.18,'highpass',1800,500,AU.sfx);pulse(t+i*0.03,600,0.2,0.05,.25,AU.sfx,1900)}},
  hurt(){if(!this.ok())return;const t=AU.ctx.currentTime;pulse(t,520,0.35,0.13,.5,AU.sfx,70);nz(t,0.35,0.35,'lowpass',2000,200,AU.sfx)},
  item(){if(!this.ok())return;const t=AU.ctx.currentTime;[72,76,79,84].forEach((m,i)=>pulse(t+i*0.05,mtof(m),0.07,0.08,.25,AU.sfx))},
  lvl(){if(!this.ok())return;const t=AU.ctx.currentTime;[72,76,79,84,88,91].forEach((m,i)=>pulse(t+i*0.06,mtof(m),0.1,0.08,.5,AU.sfx))},
  warn(){if(!this.ok())return;const t=AU.ctx.currentTime;for(let i=0;i<4;i++){pulse(t+i*0.6,600,0.3,0.1,.5,AU.sfx,950);pulse(t+i*0.6+0.3,950,0.3,0.1,.5,AU.sfx,600)}},
  burner(){if(!this.ok())return;if(playFlightSample('burner',.58))return;const t=AU.ctx.currentTime;nz(t,1.2,0.35,'bandpass',300,3000,AU.sfx);pulse(t,110,1,0.06,.5,AU.sfx,440)},
  whoosh(){if(!this.ok())return;nz(AU.ctx.currentTime,0.4,0.25,'bandpass',2400,300,AU.sfx)},
  chain(n){if(!this.ok())return;const t=AU.ctx.currentTime;pulse(t,mtof(79+Math.min(n,12)),0.12,0.08,.25,AU.sfx);pulse(t+0.06,mtof(86+Math.min(n,12)),0.14,0.07,.25,AU.sfx)},
  bonus(){if(!this.ok())return;const t=AU.ctx.currentTime;[84,88,91,96].forEach((m,i)=>pulse(t+i*0.04,mtof(m),0.06,0.07,.125,AU.sfx))},
  alarm(){if(!this.ok())return;pulse(AU.ctx.currentTime,880,0.07,0.06,.5,AU.sfx)},
  zap(){if(!this.ok())return;const t=AU.ctx.currentTime;if(t-lastShotSnd<0.08)return;lastShotSnd=t;nz(t,0.09,0.22,'highpass',4000,1500,AU.sfx);pulse(t,2400,0.07,0.05,.125,AU.sfx,300)},
  click(){if(!this.ok())return;pulse(AU.ctx.currentTime,1200,0.04,0.05,.25,AU.sfx)}};

/* =====================================================================
   설정 · 난이도 · 파일럿 레벨 특전
   ===================================================================== */
const DIFFS=[
  {id:'easy',name:'EASY',kr:'쉬움',ehp:0.7,bspd:0.8,fire:0.6,hp:140,sc:0.8},
  {id:'normal',name:'NORMAL',kr:'보통',ehp:1,bspd:1,fire:1,hp:100,sc:1},
  {id:'hard',name:'HARD',kr:'어려움',ehp:1.35,bspd:1.15,fire:1.4,hp:80,sc:1.3},
  {id:'ace',name:'ACE',kr:'에이스',ehp:1.7,bspd:1.3,fire:1.8,hp:60,sc:1.7}];
const CFG={autoUp:store.get('autoUp',true),diff:store.get('diff',0),invert:store.get('invert',true),startStage:1};
const savedUnlocked=store.get('unlock',1);
let unlocked=campaignStage(savedUnlocked);
if(savedUnlocked!==unlocked)store.set('unlock',unlocked);
const DIF=()=>DIFFS[CFG.diff];
function hullCapacity(level=1,energyLevel=0){
  const base=DIF().hp+(level>=4?20:0)+energyLevel*15;
  return Math.round(base*13/10);
}
function applyHullUpgrade(){
  const max=hullCapacity(P.lv,P.enLv);
  P.hp+=max-P.maxhp;
  P.maxhp=max;
}
const PERKS=[
  [2,'기총 공격력 +15%'],[3,'록온 속도 +40%'],[4,'최대 장갑 +26 HP'],[5,'미사일 재장전 +40%'],[6,'관통탄 (기총이 1기 관통)'],
  [7,'최대 록온 +4'],[8,'장갑 자동 수리 (20초마다)'],[9,'미사일 공격력 +50%'],[10,'LV10부터 레벨당 공격력 +5%']];
const hasPerk=l=>P.lv>=l;
const gunMult=()=>(1+(hasPerk(2)?0.15:0))*(1+Math.max(0,P.lv-9)*0.05);
const mslMult=()=>(hasPerk(9)?1.5:1)*(1+Math.max(0,P.lv-9)*0.05);

/* =====================================================================
   상태
   ===================================================================== */
const P={pts:0,enLv:0,x:0,y:50,vx:0,vy:0,hp:hullCapacity(),maxhp:hullCapacity(),scrT:0,inv:0,gunLv:1,mslLv:1,spdLv:0,agiLv:0,rollT:0,rollDir:1,rollCd:0,mslCap:8,msl:8,regen:0,lv:1,exp:0,next:150,fireT:0,alive:true,repairT:0};
const ppos=new V3(),pfwd=new V3(),tA=new V3(),tB=new V3(),tC=new V3(),ab=new V3(),ap=new V3(),UPV=new V3(0,1,0);
const XB=145,YMIN=9,YMAX=108;let ymaxCur=YMAX;
let state='title',stage=1,scrollZ=0,stageDist=0,baseSpeed=120,speed=120,speedMul=1,burnT=0,STAGE_LEN=6000;
let enemies=[],pBul=[],eOrb=[],missiles=[],emsl=[],items=[],chunks=[],stageGeos=[],pathClouds=[],events=[],launchQ=[],pops=[],bridges=[],tallB=[];
let boss=null,bossState='none',bossT=0,bossDef=null;
const bossRoster=[];
let clearRTB=0,msgs=[],locks=[],lockHeld=false,lockT=0,shake=0,hitFlash=0,cloudWhite=0,time=0,clearT=0,overT=0,score=0,hi=store.get('hi',0),view=3,paused=false;
let combo=0,comboT=0,timeScale=1,slowT=0,fovKick=0,loop=1,seenTypes=new Set();
// Airframe coordinates use the original flight model's units and nose direction.
const metal = (color, roughness = .43, metalness = .36) =>
  new THREE.MeshStandardMaterial({color, roughness, metalness, side: THREE.DoubleSide});
const paint = {
  shell: metal(0xc4cace,.49,.30), white: metal(0xf2f0e9,.44,.25), red: metal(0xc93b32,.41,.30),
  rail: metal(0x586777,.36,.62), nozzle: metal(0x323d4a,.31,.65),
  hotMetal: metal(0x716e70,.54,.55), edge: metal(0xa8afb3,.46,.55),
  glass: metal(0x175273,.15,.47), inset: metal(0x202731,.60,.13)
};
const modelKit = new THREE.Group();
// A shared aircraft skin keeps panel seams and fasteners consistent at each scale.
function skinTexture(){
  const c=document.createElement('canvas');c.width=c.height=1024;
  const g=c.getContext('2d'),r=mulberry(236);
  g.fillStyle='#aeb7bd';g.fillRect(0,0,1024,1024);
  for(let row=0;row<8;row++)for(let col=0;col<5;col++){
    const x=col*205+(row%2)*63-80,y=row*128;
    g.fillStyle='rgba('+(r()>.5?'245,241,223':'44,59,68')+','+(.03+r()*.08)+')';g.fillRect(x,y,203,126);
    g.strokeStyle='rgba(45,57,64,.62)';g.lineWidth=1.5;g.strokeRect(x+1,y+1,203,126);
    g.fillStyle='#66747d';
    for(let k=9;k<201;k+=12){g.fillRect(x+k,y+5,1.7,1.7);g.fillRect(x+k,y+122,1.7,1.7);}
  }
  for(let i=0;i<28000;i++){
    g.fillStyle=r()>.5?'rgba(12,28,48,.045)':'rgba(248,245,235,.09)';
    g.fillRect(r()*1024,r()*1024,1+r()*3,1);
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;
}
paint.shell.map=paint.white.map=skinTexture();
function fitPart(geometry, material, x=0, y=0, z=0) {
  const part = new THREE.Mesh(geometry,material);
  part.position.set(x,y,z);
  modelKit.add(part);
  return part;
}
function loft(sections, material, x=0) {
  const vertices=[], uv=[], indices=[], n=32;
  for(const [z,width,height,y] of sections) {
    for(let i=0;i<=n;i++) {
      const a=i*2*Math.PI/n;
      vertices.push(width*Math.cos(a),y+height*Math.sin(a),z);
      uv.push(i/n,(z+9)/16);
    }
  }
  for(let j=1;j<sections.length;j++) for(let i=0;i<n;i++){
    const a=(j-1)*(n+1)+i,b=a+1;
    indices.push(a,b,a+n+1,b,b+n+1,a+n+1);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(indices);g.computeVertexNormals();
  return fitPart(g,material,x);
}
function lineDetail(points,color=0x596773) {
  const geo=new THREE.BufferGeometry().setFromPoints(points.map(v=>new THREE.Vector3(...v)));
  modelKit.add(new THREE.Line(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity:.72})));
}
// Adjacent skin panels share positions but own their normals so their folds catch light.
const aircraftFacets=new Map();
function aircraftFace(material,points){
  if(!aircraftFacets.has(material))aircraftFacets.set(material,{positions:[],uv:[]});
  const batch=aircraftFacets.get(material);
  for(let i=1;i<points.length-1;i++)for(const p of [points[0],points[i],points[i+1]]){
    batch.positions.push(...p);batch.uv.push(p[0]/10+p[1]*.07+.5,(p[2]+9)/14);
  }
}
// Eight longitudinal chines form a narrow keel, broad shoulders and a flat dorsal deck.
function chineBody(sections,center,base){
  const rails=[[1,0],[.89,.46],[.45,1],[-.45,1],[-.89,.46],[-1,0],[-.61,-.8],[0,-1],[.61,-.8]];
  const rows=sections.map(([z,w,h,y])=>rails.map(([x,v])=>[center+x*w,y+v*h,z]));
  for(let j=1;j<rows.length;j++)for(let i=0;i<rails.length;i++){
    const k=(i+1)%rails.length;
    aircraftFace(base,[rows[j-1][i],rows[j-1][k],rows[j][k],rows[j][i]]);
  }
  aircraftFace(paint.inset,rows[0].slice().reverse());
  aircraftFace(paint.inset,rows[rows.length-1]);
}
chineBody([[-9.2,.035,.035,.02],[-7.8,.36,.22,.015],[-5.1,.83,.51,.03],[-3.4,1.10,.72,.03],
  [-.4,1.55,.83,.06],[1.8,1.68,.70,.05],[3.85,1.25,.49,.02],[5.10,.78,.32,-.01],
  [5.64,.54,.23,-.10],[6.49,.19,.105,-.14]],0,paint.shell);
// The raised spine terminates between the engines, leaving their two exhausts distinct.
chineBody([[-1.60,.61,.34,.74],[-.13,.76,.33,.76],[1.46,.66,.24,.69],
  [2.84,.39,.15,.57],[3.75,.05,.04,.48]],0,paint.white);
const canopySections=[[-5.45,.04,.03,.53],[-4.77,.46,.32,.56],[-3.69,.68,.68,.63],
  [-2.29,.70,.70,.68],[-1.36,.57,.51,.75],[-.86,.15,.10,.85]];
loft(canopySections,paint.glass);
for(const [z,w,h,y] of [canopySections[1],canopySections[4]]){
  const arch=[];
  for(let i=0;i<=20;i++){const a=Math.PI*i/20;arch.push([(w+.012)*Math.cos(a),y+(h+.012)*Math.sin(a),z]);}
  lineDetail(arch,0xb7bdc2);
}
// Each station is defined by its leading and trailing edges and the thickness of its spar.
function wingSurface(side,a,b,material,upper=true){
  const at=(station,t)=>{
    const [x,front,rear,y,thick]=station;
    const profile=t<=.38?t/.38:(1-t)/.62;
    return [side*x,y+profile*thick*(upper?1:-.50),front+(rear-front)*t];
  };
  for(const [lo,hi] of [[0,.38],[.38,1]]){
    const quad=[at(a,lo),at(a,hi),at(b,hi),at(b,lo)];
    if((side<0)===upper)quad.reverse();
    aircraftFace(material,quad);
  }
}
const wingStations=[[.75,-4.35,4.64,.03,.27],[2.25,-2.62,4.51,.05,.24],
  [4.95,.15,3.96,.005,.19],[5.48,.68,3.86,-.04,.14],[6.08,1.28,3.75,-.075,.11],
  [7.22,2.46,3.63,-.14,.08],[7.43,2.70,3.56,-.14,.035]];
const tailStations=[[1.12,3.93,6.01,-.18,.14],[2.44,4.53,6.46,-.24,.11],
  [4.46,6.12,7.08,-.42,.06],[4.62,6.46,7.01,-.45,.025]];
const nozzlePoint=(side,r,a,z)=>[side*1.63+r*Math.cos(a),-.14+r*.95*Math.sin(a),z];
function nozzlePetals(side){
  // The hot liner sits inside the metallic petals; the dark recess separates flame and lip.
  loft([[4.97,.91,.84,-.14],[5.25,.91,.84,-.14],[5.42,.85,.79,-.14]],paint.nozzle,side*1.63);
  const n=18,step=2*Math.PI/n;
  for(let i=0;i<n;i++){
    const a=i*step,left=a-step*.47,right=a+step*.47;
    const p=(r,angle,z)=>nozzlePoint(side,r,angle,z);
    const rootL=p(.88,left,5.25),rootM=p(.916,a,5.25),rootR=p(.88,right,5.25);
    const lipL=p(.737,left,6.73),lipM=p(.763,a,6.83),lipR=p(.737,right,6.73);
    aircraftFace(i%3===0?paint.hotMetal:paint.rail,[rootL,rootM,lipM,lipL]);
    aircraftFace(i%3===1?paint.hotMetal:paint.nozzle,[rootM,rootR,lipR,lipM]);
    aircraftFace(paint.edge,[lipL,lipM,lipR,p(.645,right,6.78),p(.65,a,6.81),p(.645,left,6.78)]);
    aircraftFace(paint.inset,[p(.645,left,6.78),p(.645,right,6.78),p(.53,right,6.28),p(.53,left,6.28)]);
  }
  const hotCore=new THREE.MeshBasicMaterial({color:0xb05630});
  fitPart(new THREE.CircleGeometry(.54,36),paint.inset,side*1.63,-.14,6.30);
  fitPart(new THREE.TorusGeometry(.44,.038,5,36),hotCore,side*1.63,-.14,6.34);
}
function tailFin(side){
  const shape=(s,z,skin)=>[side*(1.43+.48*s+skin),.48+s,z];
  const rim=[[0,1.72],[2.67,4.52],[2.67,5.47],[.89,5.83],[0,5.77]];
  const width=s=>.135-.036*s;
  const finSkin=(outline,sign,mat,bias=0)=>{
    const poly=outline.map(([s,z])=>shape(s,z,sign*(width(s)+bias)));
    if(side===sign)poly.reverse();
    aircraftFace(mat,poly);
  };
  for(const sign of [-1,1]){
    finSkin(rim,sign,paint.white);
    finSkin([[.3,5.03],[2.39,5.09],[2.39,5.52],[.87,5.81],[.3,5.78]],sign,paint.rail,.012);
    finSkin([[2.29,4.13],[2.67,4.52],[2.67,5.47],[2.29,5.55]],sign,paint.red,.019);
  }
  for(let i=0;i<rim.length;i++){
    const a=rim[i],b=rim[(i+1)%rim.length];
    aircraftFace(i===1?paint.red:paint.shell,[shape(...a,width(a[0])),shape(...b,width(b[0])),
      shape(...b,-width(b[0])),shape(...a,-width(a[0]))]);
  }
}
for(const side of [-1,1]){
  for(let i=1;i<wingStations.length;i++){
    const coat=i===4?paint.red:i===6?paint.rail:paint.white;
    wingSurface(side,wingStations[i-1],wingStations[i],coat);
    wingSurface(side,wingStations[i-1],wingStations[i],i===4?paint.red:paint.shell,false);
  }
  for(let i=1;i<tailStations.length;i++){
    wingSurface(side,tailStations[i-1],tailStations[i],i===3?paint.rail:paint.shell);
    wingSurface(side,tailStations[i-1],tailStations[i],paint.rail,false);
  }
  for(const [stations,t] of [[wingStations,.72],[tailStations,.73]]){
    const hinge=stations.slice(1).map(([x,f,r,y,h])=>[side*x,y+(1-t)/.62*h+.012,f+(r-f)*t]);
    lineDetail(hinge,0x4a5560);
  }
  // Wedge-shaped inlet shoulders blend into the wing roots ahead of each engine.
  chineBody([[-3.21,.42,.33,-.28],[-2.66,.72,.55,-.23],[-1.32,.89,.71,-.18],
    [2.75,.96,.82,-.14],[4.52,.95,.80,-.14],[5.17,.86,.73,-.14]],side*1.63,paint.shell);
  // The front edge of this fairing meets the gameplay gun barrel at its existing socket.
  chineBody([[-3.02,.19,.17,.30],[-2.55,.28,.27,.25],[-1.67,.32,.28,.22],
    [-.93,.20,.17,.20]],side*2.25,paint.shell);
  const ventL=(x,z,y)=>[side*x,y,z];
  for(let i=0;i<5;i++){
    const z=.2+i*.27;
    aircraftFace(paint.inset,[ventL(1.34,z,.666),ventL(1.89,z+.07,.67),
      ventL(1.89,z+.18,.67),ventL(1.34,z+.115,.666)]);
  }
  tailFin(side);nozzlePetals(side);
}
for(const [mat,batch] of aircraftFacets){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(batch.positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(batch.uv,2));
  g.computeVertexNormals();fitPart(g,mat);
}
function newJet(){return modelKit.clone();}
function wingMark(side) {
  const c=document.createElement('canvas');c.width=512;c.height=160;
  const g=c.getContext('2d');
  g.fillStyle='#283846';g.font='900 78px Arial';g.textAlign='center';
  g.fillText(side>0?'PA–01':'ALESTE',256,84);
  g.fillRect(64,103,384,3);
  for(let i=0;i<24;i++){g.fillRect(70+i*6,114,i%3===0?4:2,14);}
  const t=new THREE.CanvasTexture(c);
  const m=fitPart(new THREE.PlaneGeometry(1.90,.60),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  m.rotation.x=-Math.PI/2+.050;m.position.set(side*3.60,.199,2.45);
}
for(const side of [-1,1]){
  wingMark(side);
}
function lightRig(target) {
  target.add(new THREE.HemisphereLight(0xc0dafa,0x493c42,.64));
  const sunlight=new THREE.DirectionalLight(0xffc18d,1.72);
  sunlight.name='sun-key';sunlight.position.set(13,6,-15);target.add(sunlight);
  const rim=new THREE.DirectionalLight(0xafcded,.34);rim.name='sky-rim';
  rim.position.set(-8,5,9);target.add(rim);
}
function exhaust() {
  const g=new THREE.CylinderGeometry(.11,.63,1,32,24,true);g.rotateX(Math.PI/2);
  const m=new THREE.ShaderMaterial({uniforms:{phase:{value:0},burn:{value:0}},
    transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:`uniform float phase,burn;varying float tail,wave;varying vec2 q;
      void main(){q=uv;tail=position.z+.5;vec3 p=position;
      wave=sin(tail*27.-phase*26.+sin(uv.x*19.+phase*3.)*.29);
      float throttle=smoothstep(0.,.85,burn);
      p.xy*=mix(.78,1.,throttle)*(1.+tail*(.11*wave+.055*sin(tail*17.+phase*35.)));
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader:`uniform float burn,phase;varying float tail,wave;varying vec2 q;
      void main(){float throttle=smoothstep(0.,.85,burn);
      float cell=pow(.5+.5*cos(tail*24.-phase*3.+wave*.22),4.);
      float hot=exp(-tail*5.);
      vec3 idle=mix(vec3(.54,.16,.035),vec3(1.5,.54,.14),hot);
      vec3 boost=mix(vec3(.23,.13,1.25),vec3(.40,1.37,3.2),cell)+hot*vec3(1.72,1.15,.58);
      vec3 flame=mix(idle,boost,throttle);
      float a=pow(max(0.,1.-tail),mix(2.4,1.05,throttle))*(.37+.43*cell)*mix(.68,1.,throttle);
      gl_FragColor=vec4(flame,a);}`});
  return new THREE.Mesh(g,m);
}
for(const m of Object.values(paint)){m.color.convertSRGBToLinear();if(m.map)m.map.encoding=THREE.sRGBEncoding;}
lightRig(scene);

const pMesh=newJet();scene.add(pMesh);
const pFlames=[-1,1].map(side=>{
  const m=exhaust();m.position.set(side*1.63,-.14,6.83);m.userData.z=m.position.z;pMesh.add(m);return m;
});
const cityImage = 'assets/graphics/stage-1-e6774cb7fb74c9da.jpg';
const cityMap = new THREE.TextureLoader().load(cityImage);
paint.glass.color.setHex(0x417084).convertSRGBToLinear();paint.glass.metalness=.83;
cityMap.minFilter=THREE.LinearFilter;cityMap.encoding=THREE.sRGBEncoding;
const skyline=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:cityMap,fog:false,depthWrite:false}));
// Extend the side margins through a mirrored strip when the chase camera banks hard.
const skyVertices=skyline.geometry.attributes.position,skyUV=skyline.geometry.attributes.uv;
for(let i=0;i<skyVertices.count;i++){skyVertices.setX(i,skyVertices.getX(i)*2.8);skyUV.setX(i,(skyUV.getX(i)-.5)*2.8+.5);}
cityMap.wrapS=THREE.MirroredRepeatWrapping;
skyline.renderOrder=-10;
skyline.frustumCulled=false;
scene.add(skyline);
function positionSky(){
  skyline.visible=true;applyReflection(skyline.material.map);
  const depth=1050;
  const h=2*depth*Math.tan(camera.fov*Math.PI/360);
  const city=curTheme.kind==='city', ratio=city?2.333:16/9;
  const width=Math.max(h*ratio,h*camera.aspect)*(city?1.48:1.5);
  skyline.scale.set(width,width/ratio,1);
  const bias=city?Math.max(-width*.29,Math.min(-width*.11,h*camera.aspect*.32-width*.395)):0;
  skyline.position.set(P.x*.15+bias,P.y+width/ratio*(city?.22:.15)-75,scrollZ-depth);
}
function facade(seed) {
  const r=mulberry(seed), canvas=document.createElement('canvas');
  canvas.width=256;canvas.height=512;
  const g=canvas.getContext('2d');
  const gradient=g.createLinearGradient(0,0,165,510);
  gradient.addColorStop(0,'#9aaab3');gradient.addColorStop(.26,'#738898');
  gradient.addColorStop(.64,'#465763');gradient.addColorStop(1,'#34434e');
  g.fillStyle=gradient;g.fillRect(0,0,256,512);
  for(let y=0;y<512;y+=12) {
    for(let x=0;x<256;x+=16) {
      const lit=r(), alpha=.09+r()*.35;
      g.fillStyle=lit>.85?'rgba(255,200,132,'+(.27+r()*.65)+')':lit>.42?'rgba(188,216,229,'+alpha+')':'rgba(12,27,42,'+alpha+')';
      g.fillRect(x+2,y+2,12,7);
    }
    g.fillStyle='rgba(12,26,34,.73)';g.fillRect(0,y+9,256,2);
    g.fillStyle='rgba(222,218,204,.33)';g.fillRect(0,y+11,256,1);
  }
  for(let x=0;x<256;x+=64){g.fillStyle='#697780';g.fillRect(x,0,3,512);}
  const tx=new THREE.CanvasTexture(canvas);
  tx.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  tx.encoding=THREE.sRGBEncoding;
  return new THREE.MeshStandardMaterial({map:tx,roughness:.39,metalness:.48});
}
const exterior=[0,1,2,3].map(i=>facade(269+i));
const rooftop=new THREE.MeshLambertMaterial({color:0x53616a});
function towerMesh(seed,min,max,scale){
  const r=mulberry(seed),w=(5+r()*2)*scale, d=(5+r()*2)*scale, h=(min+r()*(max-min))*scale;
  const g=new THREE.BufferGeometry(),pos=[],norm=[],uv=[],faces=[[],[]];
  function block(width,depth,bottom,top,offset=0){
    const box=new THREE.BoxGeometry(width,top-bottom,depth);
    box.translate(offset,(top+bottom)/2,0);
    const base=pos.length/3;
    pos.push(...box.attributes.position.array);norm.push(...box.attributes.normal.array);
    for(let v=0;v<box.attributes.uv.count;v++){
      const raw=box.attributes.uv;
      uv.push(raw.getX(v),raw.getY(v)*Math.min(2,(top-bottom)/42)+bottom/42);
    }
    for(const group of box.groups){
      const horizontal=group.materialIndex===2||group.materialIndex===3;
      for(let i=group.start;i<group.start+group.count;i++)faces[horizontal?1:0].push(base+box.index.getX(i));
    }
    box.dispose();
  }
  const shoulder=h*(.70+r()*.18),crown=h*.97;
  block(w,d,0,shoulder);block(w*.81,d*.85,shoulder,crown,w*.05);block(w*.48,d*.60,crown,h);
  if(h>40 && seed%3===0)block(.48,.48,h,h+9);
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex([...faces[0],...faces[1]]);
  g.addGroup(0,faces[0].length,0);g.addGroup(faces[0].length,faces[1].length,1);
  const wall=exterior[seed%4];
  wall.map.wrapT=THREE.RepeatWrapping;
  g.userData.exterior=[wall,rooftop];
  return g;
}
function citySurface(){
  const c=document.createElement('canvas');c.width=c.height=512;
  const g=c.getContext('2d'),r=mulberry(893);
  g.fillStyle='#414852';g.fillRect(0,0,512,512);
  for(let i=0;i<13000;i++){g.fillStyle=r()>.5?'#444d55':'#3d444d';g.fillRect(r()*512,r()*512,2,2);}
  for(const xy of [12,54]){g.fillStyle='#a09884';g.fillRect(0,xy,512,1);g.fillRect(xy,0,1,512);}
  for(let x=70;x<512;x+=22){g.fillStyle='#b6aaa0';g.fillRect(x,33,9,1);g.fillRect(33,x,1,9);}
  g.fillStyle='#717b80';g.fillRect(66,66,439,439);
  for(let row=0;row<3;row++)for(let col=0;col<3;col++) {
    const x=77+col*144,y=77+row*144;
    g.fillStyle=['#616c73','#58656e','#697780'][Math.floor(r()*3)];g.fillRect(x,y,130,130);
    for(let i=0;i<8;i++){const u=x+8+r()*100,v=y+8+r()*100;
      g.fillStyle='#424e57';g.fillRect(u+3,v+3,14,8);g.fillStyle='#839098';g.fillRect(u,v,14,8);}
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3200/96,3200/96);
  t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return t;
}
const displayScene=new THREE.Scene(), displayCam=new THREE.PerspectiveCamera(32,1,.2,300);
lightRig(displayScene);
const coverSky=cityMap.clone();cityMap.image?.complete && (coverSky.needsUpdate=true);
displayScene.background=coverSky;
const displayJet=newJet();displayScene.add(displayJet);
function renderHangar(now) {
  if(!coverSky.image && cityMap.image){coverSky.image=cityMap.image;coverSky.needsUpdate=true;}
  if(titleFile){renderKeyArt(now);return;}
  const aspect=cw/ch, tall=aspect<1;
  const rx=Math.min(1,aspect/2.333),ry=Math.min(1,2.333/aspect);
  coverSky.repeat.set(rx,ry);coverSky.offset.set((1-rx)*.58,(1-ry)*.5);
  displayCam.aspect=aspect;displayCam.fov=tall?43:32;
  const dist=tall?1.78:Math.max(1.04,1.86/aspect);
  displayCam.position.set(13*dist,7*dist,18*dist);
  displayCam.lookAt(0,0,0);displayCam.updateProjectionMatrix();
  displayCam.setViewOffset(cw,ch,tall?0:-cw*.22,tall?ch*.14:-ch*.01,cw,ch);
  displayJet.rotation.set(.045,.15+.10*Math.sin(now*.00021),-.19+.035*Math.sin(now*.00037));
  renderFilm(displayScene,displayCam);
}

// UVs are projected onto each original surface so the older campaign assets also receive detail.
function projectSurfaceUV(geo){
  const p=geo.attributes.position,n=geo.attributes.normal;
  const uv=new Float32Array(p.count*2);
  for(let i=0;i<p.count;i++){
    const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i)),az=Math.abs(n.getZ(i));
    uv[i*2]=(ax>ay&&ax>az?p.getZ(i):p.getX(i))*.10;
    uv[i*2+1]=(ay>=ax&&ay>=az?p.getZ(i):p.getY(i))*.10;
  }
  geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));return geo;
}
const surfaceFiles=[{"color": "assets/graphics/0-color-3ee6ab399f44f33f.jpg", "normal": "assets/graphics/0-normal-9f7d131717caaee0.jpg", "rough": "assets/graphics/0-rough-249ad626451e8ce6.jpg"}, {"color": "assets/graphics/1-color-ff75153b62d73c97.jpg", "normal": "assets/graphics/1-normal-aea4fc1c7cf46a72.jpg", "rough": "assets/graphics/1-rough-79f68af2d4474759.jpg"}, {"color": "assets/graphics/2-color-5703f3716a190c61.jpg", "normal": "assets/graphics/2-normal-7126e610b61c32c0.jpg", "rough": "assets/graphics/2-rough-ddb7b36bfd01f796.jpg"}, {"color": "assets/graphics/3-color-9076103d83acdbc2.jpg", "normal": "assets/graphics/3-normal-a0f916635d779738.jpg", "rough": "assets/graphics/3-rough-250f1b8913d907ef.jpg"}, {"color": "assets/graphics/4-color-bb899b6028328a7d.jpg", "normal": "assets/graphics/4-normal-d0ec95e59ec18226.jpg", "rough": "assets/graphics/4-rough-a52acab40f820216.jpg"}, {"color": "assets/graphics/5-color-aed792546f01c9db.jpg", "normal": "assets/graphics/5-normal-545342cb72919790.jpg", "rough": "assets/graphics/5-rough-12d95d77021971dc.jpg"}, {"color": "assets/graphics/6-color-ed9c6ff62a48107d.jpg", "normal": "assets/graphics/6-normal-df9fe3b5ef8480da.jpg", "rough": "assets/graphics/6-rough-82e381863b685593.jpg"}, {"color": "assets/graphics/7-color-2822011067599c65.jpg", "normal": "assets/graphics/7-normal-860e0eafe75cebd1.jpg", "rough": "assets/graphics/7-rough-9eda4d7dcff6d1ba.jpg"}, {"color": "assets/graphics/8-color-16efa6794e2e921f.jpg", "normal": "assets/graphics/8-normal-709cf0ad3420873a.jpg", "rough": "assets/graphics/8-rough-ca4e69a472f4451d.jpg"}, {"color": "assets/graphics/9-color-4baa37db6fc783f7.jpg", "normal": "assets/graphics/9-normal-0dcd71e95d68c725.jpg", "rough": "assets/graphics/9-rough-25d582506e08490c.jpg"}, {"color": "assets/graphics/10-color-bc39eb54b95fe381.jpg", "normal": "assets/graphics/10-normal-34121d775ade2c42.jpg", "rough": "assets/graphics/10-rough-6ab86e1def1dab68.jpg"}, {"color": "assets/graphics/11-color-d4f4bdf0279df773.jpg", "normal": "assets/graphics/11-normal-fa95111a6a243224.jpg", "rough": "assets/graphics/11-rough-2f17e72b9a66a371.jpg"}, {"color": "assets/graphics/12-color-25a0319f83fbe49f.jpg", "normal": "assets/graphics/12-normal-4ae159c2554646f4.jpg", "rough": "assets/graphics/12-rough-033c0c0810e7401a.jpg"}, {"color": "assets/graphics/13-color-76f67b051274e91b.jpg", "normal": "assets/graphics/13-normal-d4e2f4acb9652ede.jpg", "rough": "assets/graphics/13-rough-a050a9612662fe7e.jpg"}, {"color": "assets/graphics/14-color-82bf3fc890965317.jpg", "normal": "assets/graphics/14-normal-48f7922288c32025.jpg", "rough": "assets/graphics/14-rough-aaae9408e80e4a30.jpg"}, {"color": "assets/graphics/15-color-5c03d39c668ec07e.jpg", "normal": "assets/graphics/15-normal-d81877e06bb70aee.jpg", "rough": "assets/graphics/15-rough-595a310d85e9b3e5.jpg"}];
const stageFiles=["assets/graphics/st-2-fde55bf85bc4ec78.jpg","assets/graphics/st-3-8fe5f0dcad998d24.jpg","assets/graphics/st-4-9a7303a9154704d7.jpg","assets/graphics/st-5-4d4569a61c31cec7.jpg","assets/graphics/st-9-610274384bb96b00.jpg"];
const titleFile="assets/graphics/title-96c243b1ac03413b.jpg";
const materialLoader=new THREE.TextureLoader();
const keyArt=titleFile?materialLoader.load(titleFile):null;
if(keyArt)keyArt.encoding=THREE.sRGBEncoding;
const coverScene=new THREE.Scene(),coverCamera=new THREE.Camera();
function renderKeyArt(now){
  coverScene.background=keyArt;
  const aspect=cw/ch,ratio=keyArt.image?.width/keyArt.image?.height||16/9;
  const breathe=1.025+.006*Math.sin(now*.00018);
  const rx=Math.min(1,aspect/ratio)/breathe,ry=Math.min(1,ratio/aspect)/breathe;
  keyArt.repeat.set(rx,ry);keyArt.offset.set((1-rx)*(aspect<1?.71:.5),(1-ry)*.48);
  // The key art is already display-graded. Preserve its print contrast in the title.
  renderer.setRenderTarget(null);const previous=renderer.outputEncoding;
  renderer.outputEncoding=THREE.sRGBEncoding;renderer.render(coverScene,coverCamera);renderer.outputEncoding=previous;
}
function surfaceMap(src,srgb){
  const tx=materialLoader.load(src);tx.wrapS=tx.wrapT=THREE.RepeatWrapping;
  tx.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);
  if(srgb)tx.encoding=THREE.sRGBEncoding;return tx;
}
const surfaceLibrary=surfaceFiles.map((f,i)=>{
  const hull=i<4||i===15;
  const material=new THREE.MeshStandardMaterial({map:surfaceMap(f.color,true),normalMap:surfaceMap(f.normal,false),
    normalScale:new THREE.Vector2(hull?.36:.53,hull?.36:.53),roughnessMap:surfaceMap(f.rough,false),
    roughness:hull?.68:.92,metalness:hull?.34:.035,vertexColors:true});
  return material;
});
const enemySkin=type=>surfaceLibrary[
  /stealth|wing|fortress|colossus|titan/.test(type)?1:
  /turret|tank|sam|walker|mlrs|hopper|crawler|beetle/.test(type)?3:
  /ship|boat|carrier|zep|golem|drone/.test(type)?2:0];
const stageSurface={city:5,land:6,canyon:8,river:11,mountain:9,sea:9,sky:9,strato:10,ruins:14};
const groundSurface={city:4,land:7,canyon:8,river:6,mountain:6,sea:12,sky:13,strato:13,ruins:14};
const distantMaps=stageFiles.map(s=>{
  const t=materialLoader.load(s);t.encoding=THREE.sRGBEncoding;t.wrapS=THREE.MirroredRepeatWrapping;t.minFilter=THREE.LinearFilter;return t;
});
const reflectionMaps=new Map();
const groundSources=new WeakMap();
const riverDetail=surfaceLibrary[12],riverWater=new THREE.MeshStandardMaterial({map:riverDetail.map.clone(),normalMap:riverDetail.normalMap,
  roughness:.54,metalness:.16,normalScale:new THREE.Vector2(.48,.48)});
riverWater.map.repeat.set(2.8,48);river.material=riverWater;river.receiveShadow=true;
function applyWorldMaterials(theme){
  const index=THEMES.indexOf(theme), back=index?distantMaps[index-1]:cityMap;
  skyline.material.map=back;skyline.material.needsUpdate=true;
  const mat=surfaceLibrary[groundSurface[theme.kind]];
  // Unique repeat transforms leave mesh textures and other levels independent.
  ground.material.normalMap=mat.normalMap;ground.material.roughnessMap=mat.roughnessMap;
  if(theme.kind!=='city'){
    for(const old of groundFrames)old?.dispose();
    const tx=mat.map.clone();tx.repeat.set(3200/110,3200/110);
    // Preserve the loader's eventual image when an early stage is selected on a cold load.
    groundSources.set(tx,mat.map);tx.needsUpdate=true;groundFrames=[tx,null];ground.material.map=tx;gridStep=110;
  }
  ground.material.normalScale.setScalar(theme.kind==='sea'?.56:.32);
  applyReflection(back);
}
let lastReflection=null;
function applyReflection(texture){
  const mapGround=ground.material.map,src=groundSources.get(mapGround);
  if(src?.image&&src.image!==mapGround.image){mapGround.image=src.image;mapGround.needsUpdate=true;}
  if(riverDetail.map.image&&riverWater.map.image!==riverDetail.map.image){riverWater.map.image=riverDetail.map.image;riverWater.map.needsUpdate=true;}
  if(river.visible)riverWater.map.offset.y=(time*.012)%1;
  if(curTheme.kind==='sea'&&mapGround)mapGround.offset.x=(time*.004)%1;
  if(!texture?.image?.width||texture===lastReflection)return;
  lastReflection=texture;
  let map=reflectionMaps.get(texture);
  if(!map){
    const env=texture.clone();env.mapping=THREE.EquirectangularReflectionMapping;env.needsUpdate=true;
    const pmrem=new THREE.PMREMGenerator(renderer);
    map=pmrem.fromEquirectangular(env).texture;reflectionMaps.set(texture,map);env.dispose();pmrem.dispose();
  }
  for(const m of [...surfaceLibrary,...Object.values(paint),...exterior,ground.material,riverWater]){
    if(m.envMap!==map){m.envMap=map;m.envMapIntensity=m===paint.glass?.81:.28;m.needsUpdate=true;}
  }
}

// SeaFort's moving gust front drives all of the visible air. Distances are in game world units.
const flightWeather={windX:-9,windZ:4,rain:0,storm:0,clock:0,drift:new THREE.Vector2(),direction:new THREE.Vector2()};
const weatherProfiles={
  city:[.06,.52,-1,.23],land:[.10,.48,-.78,.48],canyon:[.08,.22,1,.28],
  river:[.48,.85,-.82,.57],mountain:[.37,.80,.88,.48],sea:[.69,.97,-.92,.39],
  sky:[.16,.53,-.87,.49],strato:[0,.08,.62,-.37],ruins:[.47,.82,-.77,.60]
};
const weatherBaseFog=new THREE.Color(),squallFog=new THREE.Color(0x66798a).convertSRGBToLinear();
let dryFogNear=0,dryFogFar=0,dryFogDensity=0,lightningAge=2,nextStrike=8,boltNumber=0;

// A small seamless density tile supplies the two moving cloud decks and the rain shafts.
function cloudDensityTexture(){
  const size=128,random=mulberry(724),values=Float32Array.from({length:size*size},()=>random());
  function sample(x,y,f){
    const px=x*f,py=y*f,i=Math.floor(px),j=Math.floor(py);
    let u=px-i,v=py-j;u=u*u*(3-2*u);v=v*v*(3-2*v);
    const at=(a,b)=>values[(a%f)+(b%f)*size];
    const a=at(i,j)*(1-u)+at(i+1,j)*u,b=at(i,j+1)*(1-u)+at(i+1,j+1)*u;
    return a*(1-v)+b*v;
  }
  const pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size,o=(x+y*size)*4;
    pixels[o]=255*(.50*sample(u,v,4)+.28*sample(u,v,8)+.15*sample(u,v,16)+.07*sample(u,v,32));
    pixels[o+1]=255*(.48*sample(v,u,8)+.33*sample(v,u,16)+.19*sample(v,u,32));
    pixels[o+2]=255*sample(u,v,32);pixels[o+3]=255;
  }
  const t=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;
  t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.needsUpdate=true;return t;
}
const skyWeather={wxTile:{value:cloudDensityTexture()},wxDrift:{value:flightWeather.drift},
  wxAmount:{value:0},wxRain:{value:0},wxFlash:{value:0},wxBoltRay:{value:new THREE.Vector3()}};
skyline.material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,skyWeather);
  shader.vertexShader='varying vec3 wxView;\n'+shader.vertexShader.replace('#include <project_vertex>',
    '#include <project_vertex>\nwxView=(modelMatrix*vec4(transformed,1.)).xyz-cameraPosition;');
  shader.fragmentShader='varying vec3 wxView; uniform sampler2D wxTile; uniform vec2 wxDrift; uniform vec3 wxBoltRay; uniform float wxAmount,wxRain,wxFlash;\n'+shader.fragmentShader.replace('#include <map_fragment>',`
    #include <map_fragment>
    vec3 dir=normalize(wxView);
    vec2 horizon=dir.xz/max(.16,dir.y+.20);
    vec2 baseWorld=cameraPosition.xz*.00038;
    vec2 high=horizon*.36+baseWorld-wxDrift*.00050;
    vec2 low=horizon*.50+baseWorld*1.45-wxDrift*.00115;
    vec4 upper=texture2D(wxTile,high);
    vec4 lower=texture2D(wxTile,low+vec2(.23,.49));
    vec4 erosion=texture2D(wxTile,low*3.8+lower.gr*.13-wxDrift*.00024);
    float lowerDensity=lower.r+.24*(erosion.g-.50)+.10*(erosion.b-.50);
    float sheets=smoothstep(.22,.64,upper.r);
    float curls=smoothstep(.31,.68,lowerDensity);
    float overhead=smoothstep(-.09,.12,dir.y);
    vec3 base=diffuseColor.rgb;
    vec3 middle=mix(vec3(.049,.073,.115),vec3(.34,.405,.49),upper.g);
    float sideLight=clamp(.46+2.2*(lower.g-lower.r)+.46*(erosion.g-.5),0.,1.);
    vec3 scud=mix(vec3(.029,.047,.071),vec3(.22,.28,.36),sideLight);
    // Grazing daylight picks up the weather shelf's torn lower lip.
    scud+=vec3(.15,.11,.073)*(1.-smoothstep(.035,.15,abs(lowerDensity-.44)))*(1.-wxAmount*.72);
    base=mix(base,base*vec3(.49,.64,.78),wxAmount*.76);
    base=mix(base,middle,overhead*sheets*wxAmount*.86);
    base=mix(base,scud,overhead*curls*wxAmount*.86);
    float veil=(1.-smoothstep(.015,.19,abs(dir.y-.025)))*smoothstep(.38,.60,upper.r)*wxRain;
    base=mix(base,vec3(.19,.25,.32),veil*.60);
    float flash=exp(-7.*length(dir-wxBoltRay))*wxFlash;
    diffuseColor.rgb=base+vec3(.49,.56,.73)*flash;
  `);
};

function makeRain(){
  const count=isTouch?650:1150,seed=mulberry(803),xyz=new Float32Array(count*6),tip=new Float32Array(count*2);
  for(let i=0;i<count;i++){
    const p=[seed(),seed(),seed()];xyz.set(p,i*6);xyz.set(p,i*6+3);tip[2*i+1]=1;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(xyz,3));geo.setAttribute('tip',new THREE.BufferAttribute(tip,1));
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,
    uniforms:{wxOrigin:{value:new THREE.Vector3()},flow:{value:flightWeather.direction},offset:{value:flightWeather.drift},
      wet:{value:0},clock:{value:0}},
    vertexShader:`attribute float tip;uniform vec3 wxOrigin;uniform vec2 flow,offset;uniform float wet,clock;
      varying float opacity;void main(){vec3 span=vec3(152.,99.,158.);
      vec3 p=mod(position*span+vec3(offset.x,-clock*78.,offset.y)-wxOrigin,span)+wxOrigin-vec3(76.,46.,130.);
      p+=vec3(flow.x,-78.,flow.y)*tip*(.032+.026*position.x)*(.70+wet*.75);
      vec4 eye=viewMatrix*vec4(p,1.);float z=-eye.z;
      opacity=wet*smoothstep(2.,10.,z)*(1.-smoothstep(52.,163.,z))*(.14+.35*position.y)*(.58+.42*tip);
      gl_Position=projectionMatrix*eye;}`,
    fragmentShader:`varying float opacity;void main(){gl_FragColor=vec4(.57,.68,.76,opacity);}`});
  const lines=new THREE.LineSegments(geo,mat);lines.frustumCulled=false;lines.renderOrder=2;scene.add(lines);return lines;
}
const rainField=makeRain();
function makeStormBolt(){
  const seed=mulberry(842),segments=[];
  function branch(x,y,z,n,length,spread){
    for(let i=0;i<n;i++){
      const nx=x+(seed()-.5)*spread,ny=y-length*(.52+seed()*.83),nz=z+(seed()-.5)*spread;
      segments.push(x,y,z,nx,ny,nz);x=nx;y=ny;z=nz;
      if(n>10&&(i===3||i===7))branch(x,y,z,5,length*.59,spread*.92);
    }
  }
  branch(0,0,0,17,9.2,22);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(segments,3));
  const bolt=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xc5ddff,transparent:true,
    depthWrite:false,blending:THREE.AdditiveBlending}));bolt.visible=false;scene.add(bolt);return bolt;
}
const stormBolt=makeStormBolt();
function setStageWeather(){
  weatherBaseFog.copy(scene.fog.color);
  dryFogNear=scene.fog.near;dryFogFar=scene.fog.far;dryFogDensity=scene.fog.density;
  lightningAge=2;nextStrike=flightWeather.clock+4.2;stormBolt.visible=false;
}
function advanceWeather(dt){
  const w=flightWeather,profile=weatherProfiles[curTheme.kind];
  w.clock+=dt;
  const distance=stageDist/Math.max(STAGE_LEN,1);
  const front=.5-.5*Math.cos(distance*Math.PI*2.3);
  const gust=Math.max(0,Math.sin(w.clock*.74+(P.x*.64+scrollZ*.10)*.005));
  w.storm=profile[0]+(profile[1]-profile[0])*front;
  w.rain=curTheme.kind==='canyon'||curTheme.kind==='strato'?0:THREE.MathUtils.smoothstep(w.storm,.37,.88);
  const force=5+19*w.storm+gust*gust*(3+w.storm*9);
  w.windX=force*profile[2];w.windZ=force*profile[3];w.direction.set(w.windX,w.windZ);
  w.drift.x+=w.windX*dt;w.drift.y+=w.windZ*dt;
  skyWeather.wxAmount.value=w.storm;skyWeather.wxRain.value=w.rain;
  const rain=rainField.material.uniforms;
  rainField.visible=w.rain>.02;rain.wet.value=w.rain;rain.clock.value=w.clock;rain.wxOrigin.value.set(P.x,P.y,scrollZ);
  lightningAge+=dt;
  if(w.storm>.61&&w.clock>=nextStrike){
    const side=boltNumber%2?1:-1;
    stormBolt.position.set(P.x+side*(115+53*Math.sin(boltNumber*1.6)),P.y+152,scrollZ-520);
    stormBolt.rotation.y=boltNumber*1.74;boltNumber++;lightningAge=0;nextStrike=w.clock+8+2*Math.cos(boltNumber*2.41);
    skyWeather.wxBoltRay.value.copy(stormBolt.position).sub(ppos).normalize();
  }
  const flash=Math.exp(-lightningAge*9);
  stormBolt.visible=lightningAge<.55;stormBolt.material.opacity=flash;
  skyWeather.wxFlash.value=flash;
  scene.fog.color.copy(weatherBaseFog).lerp(squallFog,w.storm*.82);
  if(scene.fog.isFogExp2)scene.fog.density=dryFogDensity*(1+w.rain*.72);
  else {scene.fog.near=dryFogNear*(1-w.rain*.32);scene.fog.far=dryFogFar*(1-w.rain*.27);}
  pMat.uniforms.fogColor.value.copy(scene.fog.color);
}

// World-anchored swell, ripples and wakes share the weather clock with airborne effects.
// Existing water albedo/normal maps, light shadows, and the level's collision planes remain in use.
const flightWater = (()=>{
  const groundPlane=ground.geometry;
  let seaPlane=null, channelPlane=null, kind='', lastClock=null;
  const uniforms={
    paWaterTime:{value:0},paWaterFlow:{value:new THREE.Vector2()},
    paWaterAir:{value:new THREE.Vector3()},paWaterSky:{value:null},
    paCloudTile:skyWeather.wxTile,paCloudOffset:skyWeather.wxDrift,
    paSkyPlane:{value:new THREE.Vector4()},paHull:{value:Array.from({length:4},()=>new THREE.Vector4())}
  };
  const swell= `
    uniform float paWaterTime;
    uniform vec2 paWaterFlow;
    uniform vec3 paWaterAir;
    varying vec3 paWaterPoint;
    vec3 paSwell(vec2 p){
      // Cross seas and river currents travel in different directions. Coordinates are in world metres.
      #ifdef PA_CHANNEL
        vec2 d0=vec2(.21,-.978), d1=vec2(-.53,-.848), d2=vec2(.66,-.751);
        vec3 k=vec3(.153,.289,.572), amp=vec3(.18,.092,.034);
      #else
        vec2 d0=vec2(.94,.341), d1=vec2(.506,-.863), d2=vec2(.74,.673);
        vec3 k=vec3(.073,.168,.346), amp=vec3(1.28,.47,.17);
      #endif
      float group=.82+.18*sin(dot(p,vec2(.012,.021))-.22*paWaterTime);
      vec3 phase=vec3(dot(p,d0),dot(p,d1),dot(p,d2))*k -
        paWaterTime*sqrt(9.81*k) + vec3(0.,1.7,3.9);
      // Long wave fronts bend and break into packets as they cross the other two trains.
      float bendA=dot(p,vec2(.017,-.025))+.17*paWaterTime;
      float bendB=dot(p,vec2(-.033,.011))-.21*paWaterTime;
      phase+=vec3(.84*sin(bendA),.92*sin(bendB),1.26*sin(bendA+.7*bendB));
      amp*=group*(.85+paWaterAir.x*.52+paWaterAir.y*.30);
      vec3 slope=amp*k*cos(phase);
      return vec3(d0*slope.x+d1*slope.y+d2*slope.z,dot(amp,sin(phase)));
    }
  `;
  const surface= `
    uniform sampler2D paWaterSky,paCloudTile;
    uniform vec2 paCloudOffset;
    uniform vec4 paSkyPlane,paHull[4];
    float paWash(vec2 p){
      float foam=0.;
      for(int i=0;i<4;i++){
        vec4 h=paHull[i];
        if(h.z<=0.)continue;
        vec2 diff=p-h.xy;
        if(dot(diff,diff)>h.z*h.z*35.)continue;
        vec2 forward=vec2(sin(h.w),cos(h.w));
        float astern=-dot(diff,forward)/h.z, lateral=abs(dot(diff,vec2(forward.y,-forward.x)))/h.z;
        float flank=abs(lateral-(.06+.24*astern));
        float arm=(1.-smoothstep(.035,.17,flank))*smoothstep(-.68,.03,astern)*
          (1.-smoothstep(1.6,5.3,astern));
        float churn=(1.-smoothstep(.03,.29,lateral))*smoothstep(.30,.77,astern)*
          (1.-smoothstep(1.2,3.7,astern));
        foam=max(foam,arm*.80+churn*.61);
      }
      return foam;
    }
  `;
  function configure(material,channel){
    // Dry ground keeps the unmodified Three.js shader and can switch back to its cached program.
    material.onBeforeCompile=shader=>{
      if(!channel&&kind!=='sea')return;
      Object.assign(shader.uniforms,uniforms);
      const shared=(channel?'#define PA_CHANNEL\n':'')+swell;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+shared)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
          paWaterPoint=(modelMatrix*vec4(transformed,1.)).xyz;
          float waveHeight=paSwell(paWaterPoint.xz).z;
          #ifdef PA_CHANNEL
            // The grass plane directly underneath the channel is only 15 cm lower.
            waveHeight=clamp(waveHeight,-.08,.16)*(1.-smoothstep(55.,65.,abs(paWaterPoint.x)));
          #endif
          transformed.z+=waveHeight;paWaterPoint.y+=waveHeight;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+shared+surface)
        .replace('#include <map_fragment>',`
          vec2 waterXZ=paWaterPoint.xz;
          vec3 positiveWave=paSwell(waterXZ);
          float nearDetail=1.-smoothstep(180.,730.,length(cameraPosition-paWaterPoint));
          vec2 bakedUv=waterXZ*.011+paWaterFlow*.003+positiveWave.xy*.19;
          float baked=0.34;
          #ifdef USE_MAP
            vec3 waterSample=texture2D(map,bakedUv).rgb;
            baked=dot(waterSample,vec3(.24,.57,.19));
          #endif
          #ifdef PA_CHANNEL
            vec3 body=mix(vec3(.017,.081,.074),vec3(.033,.115,.100),baked);
            float crest=smoothstep(.19,.34,positiveWave.z)*.17;
          #else
            vec3 body=mix(vec3(.009,.039,.070),vec3(.022,.116,.148),baked);
            float crest=smoothstep(1.08,1.99,positiveWave.z+paWaterAir.x*.36);
          #endif
          float currentWash=paWash(waterXZ);
          float foamBreak=smoothstep(.17,.54,baked+.10*sin(dot(waterXZ,vec2(.39,.22))-paWaterTime*1.5));
          float foam=clamp((crest*.77+currentWash)*foamBreak,0.,.95);
          diffuseColor.rgb=mix(body*(.76+.65*baked),vec3(.57,.72,.73),foam);
        `)
        .replace('#include <roughnessmap_fragment>',`
          float roughnessFactor=.21+.095*paWaterAir.y+.045*paWaterAir.z+.33*foam;
        `)
        .replace('#include <normal_fragment_maps>',`
          vec2 ripple=vec2(0.);
          #ifdef USE_NORMALMAP
            vec2 a=texture2D(normalMap,waterXZ*.049-paWaterFlow*.012).rg*2.-1.;
            vec2 b=texture2D(normalMap,vec2(waterXZ.y,-waterXZ.x)*.087+paWaterFlow.yx*.008).rg*2.-1.;
            ripple=(a*.13+vec2(-b.y,b.x)*.077)*(.74+.37*paWaterAir.x+.26*paWaterAir.z)*nearDetail;
          #endif
          vec2 gradient=positiveWave.xy+ripple;
          vec3 waveNormal=normalize(vec3(-gradient.x,1.,-gradient.y));
          normal=normalize(mat3(viewMatrix)*waveNormal);
        `);
      shader.fragmentShader=shader.fragmentShader.replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );',`
          // Reflect the stage panorama along each facet's actual reflected view ray.
          vec3 towardEye=normalize(cameraPosition-paWaterPoint);
          vec3 reflectedRay=reflect(-towardEye,waveNormal);
          float hitDistance=(paSkyPlane.z-paWaterPoint.z)/min(-.05,reflectedRay.z);
          vec2 screenHit=paWaterPoint.xy+reflectedRay.xy*max(0.,hitDistance)-paSkyPlane.xy;
          vec2 skyUv=.5+screenHit*paSkyPlane.w*vec2(1.,1.77778);
          skyUv.y=clamp(skyUv.y,.42,.965);
          vec3 mirrored=texture2D(paWaterSky,skyUv).rgb;
          mirrored*=mirrored;
          // The same two advected cloud decks visible above the horizon reflect on each facet.
          vec2 skyRay=reflectedRay.xz/max(.16,reflectedRay.y+.20);
          vec2 worldTile=cameraPosition.xz*.00038;
          vec2 highCloud=texture2D(paCloudTile,skyRay*.36+worldTile-paCloudOffset*.00050).rg;
          vec2 lowCloud=texture2D(paCloudTile,skyRay*.50+worldTile*1.45-paCloudOffset*.00115+vec2(.23,.49)).rg;
          float storm=paWaterAir.y, rain=paWaterAir.z;
          float highCover=storm*smoothstep(.22,.64,highCloud.r);
          float lowCover=storm*smoothstep(.31,.68,lowCloud.r+.13*(lowCloud.g-.5));
          vec3 upper=mix(vec3(.049,.073,.115),vec3(.34,.405,.49),highCloud.g);
          vec3 lower=mix(vec3(.029,.047,.071),vec3(.22,.28,.36),smoothstep(.30,.67,lowCloud.g));
          mirrored*=mix(vec3(1.),vec3(.49,.64,.78),storm*.76);
          mirrored=mix(mix(mirrored,upper,highCover*.86),lower,lowCover*.86);
          mirrored=mix(mirrored,vec3(.19,.25,.32),rain*.36*(1.-smoothstep(.02,.20,abs(reflectedRay.y-.025))));
          // Thick rain screens out the unobstructed key light and spreads its most energetic highlights.
          vec3 spec=reflectedLight.directSpecular+reflectedLight.indirectSpecular;
          float screening=smoothstep(.28,.93,storm)*(.50+.50*rain);
          float peak=max(spec.r,max(spec.g,spec.b));
          outgoingLight-=spec*(1.-mix(1.,.34/(1.+3.4*peak),screening));
          float fres=.028+.78*pow(1.-max(dot(waveNormal,towardEye),0.),4.);
          float faceSky=smoothstep(.08,.58,-reflectedRay.z)*(1.-foam*.85);
          outgoingLight=mix(outgoingLight,mirrored*.86,fres*faceSky);
          gl_FragColor = vec4( outgoingLight, diffuseColor.a );`);
    };
    material.customProgramCacheKey=()=>channel?'aleste-river':kind==='sea'?'aleste-sea':'aleste-land';
  }
  configure(ground.material,false);configure(riverWater,true);
  function setStage(theme){
    const previous=kind;
    kind=theme.kind;
    if(kind==='sea'&&!seaPlane)seaPlane=new THREE.PlaneGeometry(3200,3200,isTouch?72:112,isTouch?72:112);
    if(kind==='river'&&!channelPlane){
      channelPlane=new THREE.PlaneGeometry(130,3200,9,isTouch?110:168);
      river.geometry.dispose();river.geometry=channelPlane;
    }
    ground.geometry=kind==='sea'?seaPlane:groundPlane;
    if((previous==='sea')!==(kind==='sea'))ground.material.needsUpdate=true;
    uniforms.paWaterSky.value=skyline.material.map;
    lastClock=null;
  }
  function update(weather){
    if(kind!=='river'&&kind!=='sea')return;
    const dt=lastClock===null?0:Math.min(.15,Math.max(0,weather.clock-lastClock));lastClock=weather.clock;
    uniforms.paWaterTime.value=weather.clock;
    uniforms.paWaterFlow.value.x+=dt*(weather.windX*.26+(kind==='river'?.35:1.1));
    uniforms.paWaterFlow.value.y+=dt*(weather.windZ*.26+(kind==='river'?-2.4:.62));
    uniforms.paWaterAir.value.set(Math.min(1.65,Math.hypot(weather.windX,weather.windZ)/23),weather.storm,weather.rain);
    uniforms.paSkyPlane.value.set(skyline.position.x,skyline.position.y,skyline.position.z,1/Math.max(1,skyline.scale.x));
    const slots=uniforms.paHull.value;let n=0;
    for(const e of enemies){
      if(!e.alive||e.hidden||(e.type!=='boat'&&e.type!=='destroyer'))continue;
      const depth=scrollZ-e.pos.z;
      if(depth< -80||depth>750)continue;
      slots[n++].set(e.pos.x,e.pos.z,e.type==='boat'?8.5:20,e.mesh.rotation.y);
      if(n===slots.length)break;
    }
    for(;n<slots.length;n++)slots[n].z=0;
  }
  return {setStage,update};
})();

// Bake the common aircraft once. Each formation member remains a single draw call.
function bakeAircraft(nodes){
  const positions=[],normals=[],uvs=[],colors=[],v=new V3(),n=new V3(),normalMatrix=new THREE.Matrix3();
  for(const item of nodes){
    const g=item.geometry,mat=item.material,p=g.attributes.position,normal=g.attributes.normal;
    if(!p||!normal)continue;
    const m=item.matrixWorld;normalMatrix.getNormalMatrix(m);
    for(let j=0,limit=g.index?g.index.count:p.count;j<limit;j++){
      const k=g.index?g.index.getX(j):j;
      v.fromBufferAttribute(p,k).applyMatrix4(m);n.fromBufferAttribute(normal,k).applyMatrix3(normalMatrix).normalize();
      positions.push(v.x,v.y,v.z);normals.push(n.x,n.y,n.z);
      uvs.push(v.x*.21+v.y*.16,v.z*.16+v.y*.13);
      colors.push(mat.color.r,mat.color.g,mat.color.b);
    }
  }
  const result=new THREE.BufferGeometry();
  result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  result.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  result.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  result.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return result;
}
modelKit.updateMatrixWorld(true);
for(const [type,hull,fin,scale] of [
  ['fighter',0x9f5049,0xf9bb74,1.03],['fighter2',0x8298a7,0xea5742,.98],
  ['ace',0xf1b457,0x3e5263,1.08],['bomber',0x76867a,0xca9c64,1.50]
]){
  const source=[];
  modelKit.traverse(o=>{
    if(!o.isMesh||o.material.transparent)return;
    const c=o.material===paint.shell||o.material===paint.white?new THREE.Color(hull):o.material===paint.red?new THREE.Color(fin):o.material.color;
    source.push({geometry:o.geometry,matrixWorld:o.matrixWorld,material:{color:c}});
  });
  const g=bakeAircraft(source);g.rotateY(Math.PI);g.scale(scale*(type==='bomber'?1.27:1),scale,scale);
  GEO[type]=g;
}
const scout=new THREE.Group();
function scoutPart(x,y,z,w,h,d,color){
  const m=new THREE.Mesh(new THREE.SphereGeometry(1,14,8),new THREE.MeshBasicMaterial({color}));
  m.scale.set(w,h,d);m.position.set(x,y,z);scout.add(m);
}
scoutPart(0,0,0,2.6,1.8,3.1,0x78899c);
scoutPart(0,.12,2.36,1.43,.79,1.14,0x3b454f);
scoutPart(0,.19,3.16,.82,.44,.57,0xff7345);
for(const side of [-1,1]){
  scoutPart(side*2.7,-.14,-.41,2.35,.25,1.02,0x637c93);
  scoutPart(side*3.7,-.05,-.6,.68,.65,1.64,0x364556);
}
scout.updateMatrixWorld(true);GEO.drone=bakeAircraft(scout.children);
for(const m of scout.children){m.geometry.dispose();m.material.dispose();}

const leafFiles=["assets/graphics/pine-a0241f9c83c24b6d.png", "assets/graphics/oak-32019c4e5bdcb1db.png"];
const foliageMats=leafFiles.map(src=>{
  const t=materialLoader.load(src);t.encoding=THREE.sRGBEncoding;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  return new THREE.MeshLambertMaterial({map:t,alphaTest:.32,side:THREE.DoubleSide});
});
function treeModel(index){
  const width=index?21:17,height=index?23:26,vertices=[],normals=[],uv=[],indices=[];
  for(let i=0;i<3;i++){
    const a=Math.PI*i/3,dx=Math.cos(a)*width*.5,dz=Math.sin(a)*width*.5,j=i*4;
    vertices.push(-dx,0,-dz,dx,0,dz,dx,height,dz,-dx,height,-dz);
    for(let n=0;n<4;n++)normals.push(Math.sin(a)*.38,.9,-Math.cos(a)*.38);
    uv.push(0,0,1,0,1,1,0,1);indices.push(j,j+1,j+2,j,j+2,j+3);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(indices);g.userData.exterior=foliageMats[index];return g;
}
function erodedTerrain(fn,range,scale,centerY,tint){
  const original=voxGeo(fn,range,scale,centerY,tint),p=original.attributes.position,c=original.attributes.color;
  const table=new Map(),pts=[],colors=[],counts=[],edges=[],idx=[];
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),key=[x,y,z].join(',');
    let n=table.get(key);
    if(n===undefined){n=pts.length;table.set(key,n);pts.push(new V3(x,y,z));colors.push(new V3());counts.push(0);edges.push(new Set());}
    colors[n].add(new V3(c.getX(i),c.getY(i),c.getZ(i)));counts[n]++;idx.push(n);
  }
  for(let i=0;i<idx.length;i+=3){
    for(let k=0;k<3;k++){const a=idx[i+k],b=idx[i+(k+1)%3];edges[a].add(b);edges[b].add(a);}
  }
  for(let k=0;k<5;k++){
    const next=pts.map((v,i)=>{
      const v2=new V3();for(const j of edges[i])v2.add(pts[j]);
      return v2.multiplyScalar(1/edges[i].size).lerp(v,.37);
    });
    for(let i=0;i<pts.length;i++)pts[i]=next[i];
  }
  const g=new THREE.BufferGeometry(),pos=[],col=[];
  for(let i=0;i<pts.length;i++){pos.push(...pts[i].toArray());col.push(...colors[i].multiplyScalar(1/counts[i]).toArray());}
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  g.setIndex(idx);g.computeVertexNormals();original.dispose();return projectSurfaceUV(g);
}

const densityAtlas=new THREE.TextureLoader().load('assets/graphics/smoke-atlas-68b99ae65d1a6ccc.png');
densityAtlas.minFilter=densityAtlas.magFilter=THREE.LinearFilter;
densityAtlas.generateMipmaps=false;
const frameLookup=`
  vec4 frameAt(sampler2D tex,vec2 uv,float frame){
    float f=floor(frame);vec2 cell=vec2(mod(f,8.),3.-floor(f/8.));
    return texture2D(tex,(cell+clamp(uv,.01,.99))/vec2(8.,4.));
  }`;
const effectRandom=mulberry(515);
const effectRange=(a,b)=>a+(b-a)*effectRandom();
const pyros=[],pyroQuad=new THREE.PlaneGeometry(1,1);
const pyroSource=new THREE.ShaderMaterial({
  uniforms:{atlas:{value:densityAtlas},life:{value:0},roll:{value:0},extent:{value:1},fogginess:{value:new THREE.Color()}},
  transparent:true,depthWrite:false,
  vertexShader:`uniform float roll,extent;varying vec2 q;varying float depth;
    void main(){q=uv;vec4 mv=modelViewMatrix*vec4(0.,0.,0.,1.);
    mv.xy+=mat2(cos(roll),-sin(roll),sin(roll),cos(roll))*position.xy*extent;depth=-mv.z;
    gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`uniform sampler2D atlas;uniform float life;uniform vec3 fogginess;varying vec2 q;varying float depth;
    `+frameLookup+`void main(){
    float f=life*30.99;vec4 v=mix(frameAt(atlas,q,f),frameAt(atlas,q,f+1.),fract(f));
    float fuel=clamp(v.r-.19*life+(v.b-.5)*.28,0.,1.);
    float hot=smoothstep(.38,.98,fuel),core=pow(hot,7.)*exp(-life*5.);
    vec3 ash=mix(vec3(.010,.013,.019),vec3(.18,.153,.14),v.g*v.g);
    vec3 fire=mix(vec3(.29,.008,.001),vec3(2.3,.26,.008),hot)+vec3(3.5,2.4,.74)*core;
    vec3 rgb=mix(ash,fire,smoothstep(.32,.72,fuel));
    float alpha=v.a*(1.-smoothstep(.62,1.,life));
    if(alpha<.012)discard;
    gl_FragColor=vec4(mix(rgb,fogginess,.60*smoothstep(120.,850.,depth)),alpha);}`
});
for(let i=0;i<36;i++){
  const mat=pyroSource.clone();mat.uniforms.atlas.value=densityAtlas;
  const mesh=new THREE.Mesh(pyroQuad,mat);mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=2;scene.add(mesh);
  pyros.push({mesh,age:0,duration:0,diameter:1,velocity:new THREE.Vector3()});
}
const flashes=[0,1].map(()=>{const l=new THREE.PointLight(0xff9a3b,0,125,1.4);scene.add(l);return l;});
let pyroCursor=0,flashCursor=0;
function flashExplosion(pos,size){
  const n=size>2?5:3;
  for(let i=0;i<n;i++){
    const cloud=pyros[pyroCursor++%pyros.length],m=cloud.mesh;
    cloud.age=-i*.035;cloud.duration=effectRange(1.15,1.85)+size*.09;
    cloud.diameter=(i===0?34:effectRange(16,26))*Math.sqrt(size);
    cloud.velocity.set(effectRange(-7,7),effectRange(6,13),effectRange(-9,6));
    m.position.copy(pos);if(i)m.position.addScaledVector(cloud.velocity,.64*Math.sqrt(size));
    m.material.uniforms.roll.value=effectRange(-2,2);m.material.uniforms.life.value=0;
    m.material.uniforms.extent.value=cloud.diameter;m.visible=false;
  }
  const light=flashes[flashCursor++%2];light.position.copy(pos);light.intensity=Math.min(8,2.8+size*1.2);
  light.distance=115+size*13;
}
function resetEffects(){
  for(const cloud of pyros){cloud.duration=0;cloud.mesh.visible=false;}
  for(const light of flashes)light.intensity=0;
}
function advanceEffects(dt){
  for(const p of pyros){
    if(!p.duration)continue;
    p.age+=dt;const u=p.age/p.duration;
    p.mesh.visible=u>=0&&u<1;
    if(u>=1){p.duration=0;continue;}
    if(u<0)continue;
    p.mesh.position.addScaledVector(p.velocity,dt);
    const drift=dt*u*u;
    p.mesh.position.x+=flightWeather.windX*drift;p.mesh.position.z+=flightWeather.windZ*drift;
    p.mesh.position.y+=3.8*u*dt;
    const uniforms=p.mesh.material.uniforms;
    uniforms.life.value=u;uniforms.extent.value=p.diameter*(.68+.62*u);
    uniforms.fogginess.value.copy(scene.fog.color);
  }
  for(const light of flashes)light.intensity*=Math.exp(-dt*9);
  flightSun.target.position.set(P.x*.4,2,scrollZ-94);
  flightSun.position.copy(flightSun.target.position).add(sunOffset);
  flightFill.position.copy(flightSun.target.position).add(fillOffset);
  const night=curTheme.kind==='strato'||curTheme.kind==='ruins';
  flightSun.color.setHex(night?0x96b4fd:curTheme.kind==='city'?0xffb16f:0xffdda9);
  flightSun.intensity=(night?.65:1.82)*(1-flightWeather.storm*.70)+skyWeather.wxFlash.value*.28;
  flightFill.intensity=.34+flightWeather.storm*.18;
  engineLight.intensity=pMesh.visible?.46+Math.max(0,speedMul-1)*2.1:0;
  engineLight.position.set(P.x,P.y+.4,scrollZ+7.8);
  for(const m of pFlames)m.material.uniforms.burn.value=Math.max(0,speedMul-1);
  cloudMaterial.uniforms.wind.value=time;
  cloudMaterial.uniforms.night.value=night?1:0;
}
const sunOffset=new THREE.Vector3(250,120,-275),fillOffset=new THREE.Vector3(-170,110,135);
const flightSun=scene.getObjectByName('sun-key'),flightFill=scene.getObjectByName('sky-rim');
scene.add(flightSun.target);flightFill.target=flightSun.target;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
flightSun.castShadow=true;
flightSun.shadow.mapSize.set(isTouch?512:1024,isTouch?512:1024);
Object.assign(flightSun.shadow.camera,{left:-185,right:185,top:175,bottom:-175,near:1,far:725});
flightSun.shadow.camera.updateProjectionMatrix();flightSun.shadow.bias=-.0005;flightSun.shadow.normalBias=.16;
pMesh.traverse(o=>{if(o.isMesh&&!o.material.transparent){o.castShadow=true;o.receiveShadow=true;}});
const engineLight=new THREE.PointLight(0x96bfff,.5,19,1.5);scene.add(engineLight);
const cloudMaterial=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,uniforms:{atlas:{value:densityAtlas},wind:{value:0},night:{value:0},wxGloom:skyWeather.wxAmount,wxDrift:skyWeather.wxDrift},
  vertexShader:`uniform float wind;uniform vec2 wxDrift;varying vec2 q;varying float seed,depth,wisp;
    void main(){q=uv;vec3 center=instanceMatrix[3].xyz;float scale=length(instanceMatrix[0].xyz);
    seed=fract(sin(center.x*.31+center.z*.019)*4321.);
    float shift=fract(seed+abs(wxDrift.x)*.0024);wisp=smoothstep(0.,.10,shift)*(1.-smoothstep(.89,1.,shift));
    center.xz+=(shift-.5)*vec2(sign(wxDrift.x)*105.,sign(wxDrift.y)*31.);
    center.y+=sin(wind*.12+seed*6.)*2.5;vec4 mv=viewMatrix*modelMatrix*vec4(center,1.);
    mv.xy+=position.xy*scale;depth=-mv.z;gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`uniform sampler2D atlas;uniform float wind,night,wxGloom;varying vec2 q;varying float seed,depth,wisp;
    `+frameLookup+`void main(){
    vec2 p=q;p.x+=sin(p.y*12.+wind*.16+seed*5.)*.018;
    float frame=15.+seed*12.;vec4 n=frameAt(atlas,p,frame);
    float edge=smoothstep(.36,.97,n.g+.12*q.x);
    vec3 light=mix(vec3(.18,.23,.32),vec3(1.16,.95,.72),edge);
    light=mix(light,light*vec3(.22,.28,.43),night*.85);
    light=mix(light,light*vec3(.26,.35,.49),wxGloom*.83);
    float a=n.a*(.52+wxGloom*.24)*wisp*smoothstep(3.,37.,depth)*(1.-smoothstep(580.,1150.,depth));
    if(a<.015)discard;gl_FragColor=vec4(light,a);}`
});
function cloudBank(w,h){
  const g=new THREE.PlaneGeometry(w,h);g.translate(0,h*.18,0);
  g.userData.exterior=cloudMaterial;g.userData.cloud=true;g.userData.ns=1;return g;
}

// One GPU draw holds all recent trail segments, including segments after impact.
const trailCapacity=3200,trailGeo=new THREE.InstancedBufferGeometry();
trailGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,0,1,0,0,1,0,1,-1,0,1,1,0],3));
function trailAttribute(size){
  const a=new THREE.InstancedBufferAttribute(new Float32Array(size*trailCapacity),size);
  a.setUsage(THREE.DynamicDrawUsage);return a;
}
const fromTrail=trailAttribute(3),toTrail=trailAttribute(3),trailInfo=trailAttribute(3);
trailGeo.setAttribute('aFrom',fromTrail);trailGeo.setAttribute('aTo',toTrail);trailGeo.setAttribute('aInfo',trailInfo);
trailGeo.instanceCount=0;
const trailMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,
  uniforms:{now:{value:0},haze:{value:new THREE.Color()},crosswind:{value:flightWeather.direction}},
  vertexShader:`attribute vec3 aFrom,aTo,aInfo;uniform float now;uniform vec2 crosswind;varying float life,edge,depth,kind,noisePos;
  void main(){float age=now-aInfo.x;kind=aInfo.z;life=age/(kind>.5?.48:1.65);edge=position.y;
    if(life>1.||age<0.){gl_Position=vec4(2.,2.,2.,1.);return;}
    vec3 a=(viewMatrix*vec4(aFrom,1.)).xyz,b=(viewMatrix*vec4(aTo,1.)).xyz;
    vec3 p=mix(a,b,position.x);if(kind<1.5)p+=mat3(viewMatrix)*vec3(crosswind.x,1.3,crosswind.y)*age*age*.27;
    vec2 d=b.xy/max(1.,-b.z)-a.xy/max(1.,-a.z);
    vec2 n=vec2(-d.y,d.x)/max(.00001,length(d));
    noisePos=mix(aFrom.z,aTo.z,position.x)*.12;
    p.xy+=n*edge*aInfo.y*(1.+life*3.0)*(1.+life*.24*sin(noisePos*1.8));p.y+=age*(1.1+sin(noisePos)*.60);
    depth=-p.z;gl_Position=projectionMatrix*vec4(p,1.);}`,
  fragmentShader:`uniform vec3 haze;varying float life,edge,depth,kind,noisePos;
  void main(){float drift=life*.24*sin(noisePos*1.8+life*3.);float soft=1.-smoothstep(.04,1.,abs(edge+drift));
    vec3 c=mix(vec3(.59,.66,.71),vec3(1.03,.93,.73),smoothstep(-.6,.7,edge));
    c+=vec3(3.6,1.14,.16)*exp(-life*38.)*exp(-edge*edge*14.);
    if(kind>.5)c=vec3(.71,.82,.95);
    if(kind>1.5)c=mix(vec3(4.3,2.2,.5),vec3(1.1,.18,.008),life);
    float a=soft*pow(max(0.,1.-life),1.5)*(.79+.21*sin(noisePos+life*4.))*(kind>.5?.37:.83);
    if(kind>1.5)a=soft*(1.-life);
    gl_FragColor=vec4(mix(c,haze,smoothstep(200.,900.,depth)*.68),a);}`
});
const trailMesh=new THREE.Mesh(trailGeo,trailMat);trailMesh.frustumCulled=false;trailMesh.renderOrder=1;scene.add(trailMesh);
let trailHead=0;
function trailSegment(a,b,width,kind=0){
  const i=trailHead++%trailCapacity;
  fromTrail.setXYZ(i,a.x,a.y,a.z);toTrail.setXYZ(i,b.x,b.y,b.z);trailInfo.setXYZ(i,time,width,kind);
  trailGeo.instanceCount=Math.min(trailHead,trailCapacity);
  fromTrail.needsUpdate=toTrail.needsUpdate=trailInfo.needsUpdate=true;
}
const wingPrev=[new THREE.Vector3(),new THREE.Vector3()],wingNext=new THREE.Vector3();
let wingContinuous=false;
function updateTrails(){
  trailMat.uniforms.now.value=time;trailMat.uniforms.haze.value.copy(scene.fog.color);
  const turning=state==='play'&&P.alive&&(Math.abs(P.vx)>40||speedMul>1.17);
  if(turning){
    pMesh.updateMatrixWorld();
    for(let i=0;i<2;i++){
      wingNext.set((i?1:-1)*6.9,.12,3.4).applyMatrix4(pMesh.matrixWorld);
      if(wingContinuous)trailSegment(wingPrev[i],wingNext,.2,1);
      wingPrev[i].copy(wingNext);
    }
  }
  wingContinuous=turning;
}

// Socket-space flashes and world-space tracers meet at the same point on the wing root.
const gunPorts=[new THREE.Vector3(-2.25,.32,-2.7),new THREE.Vector3(2.25,.32,-2.7)];
const gunSockets=gunPorts.map((port,i)=>{
  const base=new THREE.Group();base.position.copy(port);pMesh.add(base);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.135,.22,1.45,12),paint.nozzle);
  barrel.rotation.x=Math.PI*.5;base.add(barrel);
  const exit=new THREE.Group();exit.position.z=-.8;base.add(exit);
  const jet=new THREE.Mesh(new THREE.ConeGeometry(.44,3.6,12,1,true),new THREE.MeshBasicMaterial({
    color:new THREE.Color(5.8,2.4,.32),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
  jet.geometry.rotateX(-Math.PI/2);jet.position.z=-1.8;exit.add(jet);
  const card=new THREE.Sprite(new THREE.SpriteMaterial({map:flareTexture(),color:new THREE.Color(4.4,1.82,.35),
    transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  card.scale.set(3.8,2.4,1);exit.add(card);exit.visible=false;
  const tip=port.clone();tip.z-=.8;
  return {exit,tip,jet,card,age:0,side:i?1:-1};
});
function flareTexture(){
  const c=document.createElement('canvas');c.width=c.height=64;
  const g=c.getContext('2d'),glow=g.createRadialGradient(32,32,1,32,32,31);
  glow.addColorStop(0,'white');glow.addColorStop(.12,'rgba(255,255,245,.94)');glow.addColorStop(.38,'rgba(255,224,172,.32)');glow.addColorStop(1,'rgba(255,166,76,0)');
  g.fillStyle=glow;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);
}
let firingPort=0;
const gunLight=new THREE.PointLight(0xffb167,0,19,1.6);scene.add(gunLight);
function lightMuzzle(index){
  const socket=gunSockets[index];socket.age=.089;
  const p=pMesh.localToWorld(socket.tip.clone());
  gunLight.position.copy(p);gunLight.intensity=3.7;
  emit(2,p.x,p.y,p.z,0,0,-speed, .065,2.0,.28,0);
  return p;
}
function updateMuzzles(dt){
  gunLight.intensity*=Math.exp(-dt*24);
  for(const s of gunSockets){
    s.age=Math.max(0,s.age-dt);s.exit.visible=s.age>0;
    if(!s.exit.visible)continue;
    const power=s.age/.089;
    s.jet.scale.set(1,1,.65+power*.95);s.jet.material.opacity=power;
    s.card.material.opacity=power*.87;s.card.material.rotation=s.side*(.48+power);
  }
}
const shockGeo=new THREE.RingGeometry(.86,1,64);
const ripples=Array.from({length:10},()=>{
  const mat=new THREE.ShaderMaterial({uniforms:{amount:{value:0}},transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:'varying vec2 q;void main(){q=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'uniform float amount;varying vec2 q;void main(){float edge=1.-smoothstep(.008,.065,abs(length(q)-.936));gl_FragColor=vec4(vec3(1.5,.65,.2),amount*edge);}'});
  const ring=new THREE.Mesh(shockGeo,mat);ring.visible=false;scene.add(ring);return {ring,elapsed:1,size:1};
});
let rippleIndex=0;
const flyingEmbers=Array.from({length:180},()=>({p:new THREE.Vector3(),v:new THREE.Vector3(),life:0}));
let emberIndex=0;
const emberLast=new THREE.Vector3();
function impactFront(p,size){
  const r=ripples[rippleIndex++%ripples.length];r.elapsed=0;r.size=size;r.ring.position.copy(p);
  r.ring.quaternion.copy(camera.quaternion);r.ring.visible=true;
  const count=Math.min(22,Math.ceil(7*Math.sqrt(size)));
  for(let i=0;i<count;i++){
    const e=flyingEmbers[emberIndex++%flyingEmbers.length];
    e.p.copy(p);e.v.set(effectRange(-1,1),effectRange(-.7,1),effectRange(-1,1)).normalize().multiplyScalar(effectRange(15,50)*Math.sqrt(size));
    e.life=effectRange(.18,.55);
  }
}
function updateImpactFront(dt){
  for(const e of flyingEmbers)if(e.life>0){
    emberLast.copy(e.p);e.p.addScaledVector(e.v,dt);e.v.multiplyScalar(Math.exp(-dt*1.5));e.v.y-=14*dt;
    trailSegment(emberLast,e.p,.18,2);e.life-=dt;
  }
  for(const r of ripples){
    if(!r.ring.visible)continue;
    r.elapsed+=dt;const u=r.elapsed/.29;
    if(u>=1){r.ring.visible=false;continue;}
    r.ring.scale.setScalar((3+u*16)*Math.sqrt(r.size));
    r.ring.material.uniforms.amount.value=(1-u)*(1-u)*.52;
  }
}

// Arcade speed units are mapped to the same airspeed shown on the HUD.
const soundBarrier={speedKmh:1225,armed:true,elapsed:10};
const sonicHull=new THREE.LatheGeometry([[.55,-3.5],[2.8,-2.5],[5.5,-.8],[8,1.8],[9,3.2]].map(v=>new THREE.Vector2(...v)),64);
sonicHull.rotateX(Math.PI/2);
const condensation=new THREE.Mesh(sonicHull,new THREE.ShaderMaterial({
  uniforms:{age:{value:0}},side:THREE.DoubleSide,depthWrite:false,transparent:true,
  vertexShader:`uniform float age;varying vec2 q;void main(){q=uv;vec3 p=position;
    p.xy*=.72+.48*smoothstep(0.,.28,age);p.z+=age*9.;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
  fragmentShader:`uniform float age;varying vec2 q;void main(){
    float waves=sin(q.x*75.+sin(q.x*30.)*2.+age*13.)*.035+sin(q.x*131.-age*29.)*.02;
    float rim=exp(-pow((q.y-.76-waves)*6.,2.));
    float a=(.18*sin(q.y*3.1416)+.72*rim)*smoothstep(0.,.075,age)*(1.-smoothstep(.19,.58,age));
    gl_FragColor=vec4(mix(vec3(.59,.74,.87),vec3(1.7,1.52,1.31),rim),a);}`
}));
condensation.visible=false;condensation.renderOrder=4;pMesh.add(condensation);
function sonicAudio(){
  if(!AU.ctx||!AU.on)return;
  if(typeof playFlightSample==='function'&&playFlightSample('sonic',.8))return;
  const t=AU.ctx.currentTime;
  nz(t,.12,.36,'lowpass',1350,120,AU.sfx);tri(t,97,.36,.3,AU.sfx,38);
  nz(t+.082,.40,.20,'lowpass',540,65,AU.sfx);
}
function updateMach(rdt){
  const mach=speed*6/soundBarrier.speedKmh;
  if(mach<.91)soundBarrier.armed=true;
  if(state==='play'&&mach>=1&&soundBarrier.armed){
    soundBarrier.armed=false;soundBarrier.elapsed=0;sonicAudio();
  }else soundBarrier.elapsed+=rdt;
  condensation.visible=view===3&&state==='play'&&soundBarrier.elapsed<.58;
  condensation.material.uniforms.age.value=soundBarrier.elapsed;
}
function pressureShake(){
  const t=soundBarrier.elapsed;
  if(t>=.62||state!=='play')return;
  const a=Math.exp(-t*8)*Math.min(1,t*55);
  camera.translateX(a*Math.sin(t*88)*.95);
  camera.translateY(a*Math.sin(t*66+.4)*.80);
  camera.rotateZ(a*Math.sin(t*74)*.024);
  camera.fov+=a*3;camera.updateProjectionMatrix();
}

// All scene layers share the same exposure. HUD canvas is composed afterwards.
function makeFilmPass(){
  const hdr=renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  const target=(depth=false)=>new THREE.WebGLRenderTarget(1,1,{
    type:hdr?THREE.HalfFloatType:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
    format:THREE.RGBAFormat,depthBuffer:depth,stencilBuffer:false,generateMipmaps:false
  });
  const main=target(true),bright=target(),broad=target(),soft=target();
  const depthSupported=renderer.capabilities.isWebGL2||renderer.extensions.has('WEBGL_depth_texture');
  if(depthSupported)main.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedShortType);
  const screen=new THREE.Scene(), lens=new THREE.Camera();
  const uniforms={source:{value:null},sceneColor:{value:main.texture},closeBloom:{value:bright.texture},
    wideBloom:{value:soft.texture},depthMap:{value:main.depthTexture||main.texture},stepSize:{value:new THREE.Vector2()},
    sunScreen:{value:new THREE.Vector2()},shafts:{value:0},aspect:{value:1},clock:{value:0},
    nozzles:{value:[new THREE.Vector2(),new THREE.Vector2()]},plume:{value:0},screenPixel:{value:new THREE.Vector2()}};
  function shader(body){return new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:'varying vec2 vUv;uniform sampler2D source;uniform vec2 stepSize;\n'+body});}
  const extract=shader(`void main(){
    vec3 c=texture2D(source,vUv).rgb;float l=max(c.r,max(c.g,c.b));
    gl_FragColor=vec4(c*smoothstep(.63,1.26,l),1.);
  }`);
  const blur=shader(`void main(){vec2 d=stepSize;
    vec3 c=texture2D(source,vUv).rgb*0.24;
    c+=(texture2D(source,vUv+d).rgb+texture2D(source,vUv-d).rgb+texture2D(source,vUv+vec2(d.x,-d.y)).rgb+texture2D(source,vUv+vec2(-d.x,d.y)).rgb)*.19;
    gl_FragColor=vec4(c,1.);}`);
  const compose=shader(`
    uniform sampler2D sceneColor,closeBloom,wideBloom,depthMap;
    uniform vec2 sunScreen,nozzles[2],screenPixel;
    uniform float shafts,aspect,clock,plume;
    vec3 film(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
    void main(){
      vec2 uv=vUv;
      for(int i=0;i<2;i++){
        vec2 d=uv-nozzles[i];d.x*=aspect;float mask=exp(-dot(d,d)/.00055)*plume;
        uv.x+=sin(uv.y*205.+clock*46.+sin(uv.x*90.))*.0019*mask;
        uv.y+=sin(uv.x*188.-clock*42.)*.0012*mask;
      }
      vec3 raw=texture2D(sceneColor,uv).rgb;
      vec3 lo=texture2D(sceneColor,uv-screenPixel*.5).rgb,hi=texture2D(sceneColor,uv+screenPixel*.5).rgb;
      raw=mix(raw,(lo+hi)*.5,.23);
      vec3 c=raw+min(texture2D(closeBloom,uv).rgb,vec3(4.))*.10+min(texture2D(wideBloom,uv).rgb,vec3(3.))*.24;
      if(shafts>0.001){
        vec2 toSun=sunScreen-uv;float transmission=0.;
        for(int i=0;i<14;i++){
          float f=(float(i)+.5)/14.;vec2 q=uv+toSun*f*.88;
          float visible=step(.99997,texture2D(depthMap,q).r);
          vec3 cloud=texture2D(wideBloom,q).rgb;
          transmission+=visible*(.12+min(1.5,cloud.r))*(1.-f*.68);
        }
        float dist=length(toSun*vec2(aspect,1.));
        c+=vec3(1.,.52,.19)*transmission/14.*shafts*.54*exp(-dist*2.5);
      }
      c*=1.-.12*smoothstep(.28,.78,length(vUv-.5));
      c=pow(film(max(c,vec3(0.))*.95),vec3(1./2.22));
      gl_FragColor=vec4(c,1.);
    }`);
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),compose);quad.frustumCulled=false;screen.add(quad);
  function pass(material,input,output,radius=1){
    uniforms.source.value=input.texture;uniforms.stepSize.value.set(radius/input.width,radius/input.height);
    quad.material=material;renderer.setRenderTarget(output);renderer.render(screen,lens);
  }
  const projected=new THREE.Vector3();
  return function renderFilm(world,cam){
    const width=renderer.domElement.width,height=renderer.domElement.height;
    if(main.width!==width||main.height!==height){
      main.setSize(width,height);
      bright.setSize(Math.max(1,width>>2),Math.max(1,height>>2));
      for(const t of [broad,soft])t.setSize(Math.max(1,width>>3),Math.max(1,height>>3));
      uniforms.screenPixel.value.set(1/width,1/height);
    }
    const flying=world===scene;
    uniforms.shafts.value=flying&&curTheme.kind==='city'&&depthSupported?.90:0;
    if(uniforms.shafts.value){
      projected.copy(skyline.position);projected.x+=skyline.scale.x*.395;projected.y+=skyline.scale.y*.022;projected.project(cam);
      uniforms.sunScreen.value.set(projected.x*.5+.5,projected.y*.5+.5);
    }
    uniforms.plume.value=flying&&pMesh.visible&&view===3?Math.min(1,.33+(speedMul-1)*.85):0;
    if(uniforms.plume.value)for(let i=0;i<2;i++){
      projected.set((i?1:-1)*1.63,-.14,9.2+speedMul*1.5);
      pMesh.localToWorld(projected);projected.project(cam);
      uniforms.nozzles.value[i].set(projected.x*.5+.5,projected.y*.5+.5);
    }
    uniforms.aspect.value=width/height;uniforms.clock.value=time;
    renderer.setRenderTarget(main);renderer.render(world,cam);
    pass(extract,main,bright);pass(blur,bright,broad,2);pass(blur,broad,soft,2.2);
    pass(compose,main,null);
  };
}
const renderFilm=makeFilmPass();

function msg(t,c='#b6ffc4',big=false,dur=2){msgs.push({t,c,big,dur,a:0})}
function segDist(a,b,p){ab.subVectors(b,a);ap.subVectors(p,a);const t=clamp(ap.dot(ab)/Math.max(1e-6,ab.lengthSq()),0,1);return ap.sub(ab.multiplyScalar(t)).length()}

/* =====================================================================
   월드 빌드 (청크 인스턴스)
   ===================================================================== */
const CHK=400;
let obst=[],obIdx=0;
function addInstances(geo,list){
  if(!geo.userData.ns){if(!geo.boundingBox)geo.computeBoundingBox();const bb=geo.boundingBox,ext=Math.max(bb.max.x,-bb.min.x,bb.max.z,-bb.min.z)*0.7;
    for(const o of list){const sc=o.s||1,r=ext*sc,y0=(o.y||0)+bb.min.y*sc,y1=(o.y||0)+bb.max.y*sc*0.92;if(Math.abs(o.x)-r<XB+4&&y1>YMIN&&r>2)obst.push({x:o.x,z:o.z,r,y0,y1})}}
  const groups={};for(const o of list){const g=Math.floor(-o.z/CHK);(groups[g]=groups[g]||[]).push(o)}
  for(const g in groups){const arr=groups[g];const m=new THREE.InstancedMesh(geo,geo.userData.exterior||surfaceLibrary[stageSurface[curTheme.kind]],arr.length);
    arr.forEach((o,i)=>{dummy.position.set(o.x,o.y||0,o.z);dummy.rotation.set(0,o.ry||0,0);dummy.scale.setScalar(o.s||1);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix)});
    m.castShadow=m.receiveShadow=!geo.userData.cloud;m.frustumCulled=false;scene.add(m);chunks.push({mesh:m,near:-g*CHK,far:-(g+1)*CHK})}
}
function sg(geo){stageGeos.push(geo);return geo}
const RING_GEO=new THREE.TorusGeometry(15,1.25,12,72),RING_MAT=new THREE.MeshBasicMaterial({color:0xffd84a});
let rings=[],extraMeshes=[];
function clearWorld(){resetEffects();for(const r of ripples)r.ring.visible=false;for(const s of gunSockets){s.age=0;s.exit.visible=false;}gunLight.intensity=0;trailHead=0;trailGeo.instanceCount=0;wingContinuous=false;obst=[];obIdx=0;clearBeams();for(const z of zones)scene.remove(z.mesh);zones=[];
  for(const c of chunks)scene.remove(c.mesh);chunks=[];for(const g of stageGeos)g.dispose();stageGeos=[];pathClouds=[];bridges=[];tallB=[];for(const m of extraMeshes)scene.remove(m);extraMeshes=[];rings=[];
  for(const e of enemies){scene.remove(e.mesh);if(e.ring)scene.remove(e.ring);if(e.parts)for(const p of e.parts)scene.remove(p.mesh)}
  for(const it of items)scene.remove(it.mesh);enemies=[];pBul=[];eOrb=[];missiles=[];emsl=[];items=[];locks=[];launchQ=[];pops=[];bolts=[];boss=null;bossDef=null;bossRoster.length=0;
}
function groundTarget(type,x,y,z,extra={}){
  const sourceStage=stageSourceNumber();
  const def={turret:[5,300],tank:[6,400],sam:[7,500],destroyer:[16,900],boat:[7,450],walker:[8,550],mlrs:[9,650]}[type];
  const e=mkEnemy(type,Object.assign({hp:Math.round((def[0]+sourceStage)*DIF().ehp),r:type==='destroyer'?14:type==='boat'?8:5.5,ground:true,pts:def[1],exp:type==='destroyer'?50:25,kind:'g'},extra));
  e.pos.set(x,y,z);e.base=new V3(x,y,z);e.mesh.position.copy(e.pos);e.fireT=rnd(0.5,2.5);if(e.pop){e.popY=-8;e.mesh.position.y=y-8;e.hidden=true;e.mesh.visible=false}
}
function buildWorld(th){
  const sourceStage=stageSourceNumber();
  const L=STAGE_LEN+1500,T=th.tint,R=Math.random,inPlay=z=>z<-450&&z>-STAGE_LEN;
  const ct=T?[Math.min(1,T[0]*1.1),Math.min(1,T[1]*1.1),Math.min(1,T[2]*1.1)]:null;
  const clouds=[0,1,2].map(i=>sg(cloudBank(115+i*16,44+i*8)));const cl=[[],[],[]];
  const sideClouds=(n,yr)=>{for(let i=0;i<n;i++){const s=R()<0.5?-1:1;cl[i%3].push({x:s*rnd(150,380),y:rnd(...yr),z:-rnd(0,L),ry:rnd(0,6),s:rnd(0.8,1.6)})}};
  const pathCl=(step)=>{for(let z=-500;z>-STAGE_LEN;z-=step*rnd(0.7,1.3)){const x=rnd(-90,90),y=rnd(30,80);cl[0].push({x,y,z,ry:0,s:1.5});pathClouds.push(new V3(x,y+9,z))}};
  const trees=(geoList,inner,outer,step,dens)=>{const ls=geoList.map(()=>[]);for(let z=0;z>-L;z-=step)for(const s of[-1,1]){if(R()<dens)ls[rint(0,ls.length-1)].push({x:s*rnd(inner,outer),z:z-rnd(0,step),ry:rnd(0,6),s:rnd(0.9,1.5)})}ls.forEach((l,i)=>addInstances(geoList[i],l))};
  const pine=()=>sg(treeModel(0)),round=()=>sg(treeModel(1));
  const islands=(n,xr,gap,targets)=>{const isl=[];for(let i=0;i<n;i++){const s=islandShape(rint(6,13),sourceStage*100+i);isl.push({geo:sg(erodedTerrain(s.fn,s.range,2,false,T)),top:s.top})}
    const lists=isl.map(()=>[]);for(let z=-60;z>-L;z-=rnd(...gap)){const v=rint(0,n-1),x=rnd(-xr,xr),s=rnd(0.8,1.4);lists[v].push({x,z,ry:rnd(0,6.28),s});
      if(targets&&Math.abs(x)<130&&inPlay(z)&&R()<0.25+sourceStage*0.02)groundTarget('turret',x,isl[v].top*s,z)}lists.forEach((l,i)=>addInstances(isl[i].geo,l))};
  const ships=(gap,xr)=>{const g=sg(voxGeo(shipShape,[-3,3,0,6,-7,7],2,false,T)),l=[];for(let z=-200;z>-L;z-=rnd(...gap))l.push({x:rnd(-xr,xr),z,ry:R()<0.5?0:Math.PI});addInstances(g,l)};
  const cityBlocks=(inner,outer,step,dens,hMin,hMax,win,scale)=>{const g=[0,1,2,3].map(i=>sg(th.kind==="city"?towerMesh(sourceStage*20+i,hMin,hMax,scale):voxGeo(buildingShape(sourceStage*20+i,hMin,hMax,win),[-4,4,0,hMax+1,-4,4],scale,false,T))),ls=g.map(()=>[]);
    for(let z=0;z>-L;z-=step)for(const s of[-1,1])if(R()<dens)ls[rint(0,3)].push({x:s*rnd(inner,outer),z:z-rnd(0,step),ry:rint(0,3)*Math.PI/2,s:rnd(0.85,1.3)});ls.forEach((l,i)=>addInstances(g[i],l))};
  const k=th.kind;
  const bridgesFn=(gap)=>{const br=sg(voxGeo(bridgeShape([.55,.25,.2],[.35,.33,.32]),[-70,70,0,21,-3,3],3,false,T)),bl=[];
    for(let z=-500;z>-L;z-=rnd(...gap)){bl.push({x:0,z});bridges.push({z,passed:false,name:'BRIDGE'});if(inPlay(z))for(const x of[-150,-60,60,150])if(R()<0.45)groundTarget('turret',x+rnd(-15,15),39,z)}br.userData.ns=1;addInstances(br,bl)};
  const ringsFn=(gap,yr)=>{for(let z=-650;z>-STAGE_LEN;z-=rnd(...gap)){const m=new THREE.Mesh(RING_GEO,RING_MAT),p=new V3(rnd(-95,95),rnd(...yr),z);m.position.copy(p);scene.add(m);extraMeshes.push(m);rings.push({pos:p,mesh:m,passed:false})}};
  if(k==='city'){
    cityBlocks(160,450,12,0.85,8,18,false,3);cityBlocks(30,140,26,0.35,1,4,false,3);cityBlocks(200,470,30,0.6,20,30,false,4);
    const sky=[0,1,2].map(i=>sg(towerMesh(sourceStage*30+i,29,31,4))),skl=sky.map(()=>[]);
    for(let z=-450;z>-STAGE_LEN;z-=rnd(170,260)){const x=(R()<0.5?-1:1)*rnd(40,135),sc=rnd(0.85,1.05);skl[rint(0,2)].push({x,z,s:sc});tallB.push({x,z,hw:3.5*4*sc,h:120})}
    sky.forEach(g=>g.userData.ns=1);skl.forEach((l,i)=>addInstances(sky[i],l));
    const ovp=sg(voxGeo(overpassShape([.55,.56,.6],[.3,.31,.34]),[-70,70,0,13,-3,3],3,false,T)),ol=[];
    for(let z=-380;z>-L;z-=rnd(420,620)){if(tallB.some(b=>Math.abs(b.z-z)<40))z-=60;ol.push({x:0,z});bridges.push({z,passed:false,under:28,hitHi:41,over:44,name:'OVERPASS'});
      if(inPlay(z)&&R()<0.6)groundTarget('turret',rnd(-150,150),36,z)}ovp.userData.ns=1;addInstances(ovp,ol);
    const tw=sg(voxGeo(towerShape(glow([1,.2,.2]),true),[-3,3,0,16,-3,3],2.4,false,T)),tl=[];for(let z=-100;z>-L;z-=rnd(150,260))tl.push({x:(R()<0.5?-1:1)*rnd(148,156),z});addInstances(tw,tl);
    for(let z=-500;z>-STAGE_LEN;z-=rnd(130,220))groundTarget(R()<0.5?'sam':'turret',rnd(-130,130),0,z);
  }else if(k==='land'){
    const barn=sg(voxGeo(barnShape,[-5,5,0,7,-4,4],2.2,false,T)),hay=sg(voxGeo(hayShape,[-2,2,0,2,-2,2],2.2,false,T));
    const house=sg(voxGeo(houseShape([.7,.3,.2],[.35,.5,.7]),[-4,4,0,6,-3,3],2.2,false,T));
    const bl=[],hl=[],hs=[];for(let z=0;z>-L;z-=rnd(60,120)){const sd=R()<0.5?-1:1;bl.push({x:sd*rnd(90,400),z,ry:rint(0,3)*Math.PI/2});for(let i=0;i<4;i++)hl.push({x:sd*rnd(60,420),z:z-rnd(0,60),ry:0});if(R()<0.5)hs.push({x:-sd*rnd(80,380),z:z-rnd(0,40),ry:rint(0,3)*Math.PI/2})}
    addInstances(barn,bl);addInstances(hay,hl);addInstances(house,hs);trees([round()],40,460,14,0.5);
    const rock=sg(erodedTerrain(cliffShape(sourceStage*7,CP.grass,CP.rock,CP.rock2),[-7,7,0,19,-7,7],1.6,false,T)),rl=[];for(let z=0;z>-L;z-=rnd(90,180))rl.push({x:(R()<0.5?-1:1)*rnd(40,350),z,ry:rnd(0,6),s:rnd(0.7,1.3)});addInstances(rock,rl);
    for(let z=-500;z>-STAGE_LEN;z-=rnd(140,240))groundTarget(R()<0.65?'tank':'sam',rnd(-120,120),0,z);sideClouds(30,[60,160]);
  }else if(k==='canyon'){
    const red=[[.84,.6,.38],[.78,.4,.24],[.9,.58,.34]];
    const cl2=[0,1,2,3].map(i=>sg(erodedTerrain(cliffShape(sourceStage*10+i,...red),[-7,7,0,19,-7,7],4.2,false,T))),cls=cl2.map(()=>[]);
    for(let z=0;z>-L;z-=rnd(18,26))for(const sd of[-1,1]){cls[rint(0,3)].push({x:sd*rnd(150,165),z,ry:rnd(0,6),s:rnd(0.9,1.25)});if(R()<0.6)cls[rint(0,3)].push({x:sd*rnd(210,300),z:z-rnd(0,10),ry:rnd(0,6),s:rnd(1.1,1.7)})}
    for(let z=0;z>-L;z-=rnd(60,120))cls[rint(0,3)].push({x:(R()<0.5?-1:1)*rnd(330,480),z,ry:rnd(0,6),s:rnd(2,3)});
    cls.forEach((l,i)=>addInstances(cl2[i],l));
    const hood=sg(erodedTerrain(cliffShape(sourceStage*13,...red),[-7,7,0,19,-7,7],2.2,false,T)),hl=[];
    for(let z=-500;z>-STAGE_LEN;z-=rnd(130,220)){const x=(R()<0.5?-1:1)*rnd(35,130),sc=rnd(1.4,1.9);hl.push({x,z,ry:rnd(0,6),s:sc});tallB.push({x,z,hw:4.2*2.2*sc,h:19*2.2*sc})}
    hood.userData.ns=1;addInstances(hood,hl);
    for(let z=-500;z>-STAGE_LEN;z-=rnd(150,240))groundTarget(R()<0.6?'tank':'turret',rnd(-120,120),0,z);
  }else if(k==='river'){
    const reed=sg(voxGeo(reedShape,[-2,2,0,3,-2,2],2.2,false,T)),rd=[];for(let z=0;z>-L;z-=6)for(const sd of[-1,1])if(R()<0.6)rd.push({x:sd*rnd(64,80),z:z-rnd(0,6),ry:rnd(0,6)});reed.userData.ns=1;addInstances(reed,rd);
    trees([pine(),round()],90,460,8,0.85);
    const house=sg(voxGeo(houseShape([.3,.35,.6],[.35,.5,.7]),[-4,4,0,6,-3,3],2,false,T)),hl=[];for(let z=0;z>-L;z-=rnd(50,110))hl.push({x:(R()<0.5?-1:1)*rnd(95,160),z,ry:rint(0,3)*Math.PI/2});addInstances(house,hl);
    bridgesFn([480,640]);ships([150,300],45);
    for(let z=-500;z>-STAGE_LEN;z-=rnd(170,280))groundTarget('boat',rnd(-45,45),0,z,{sway:rnd(10,25)});
    for(let z=-700;z>-STAGE_LEN;z-=rnd(350,500))groundTarget('sam',(R()<0.5?-1:1)*rnd(90,130),0,z);sideClouds(30,[60,150]);
  }else if(k==='mountain'){
    const mts=[0,1,2].map(i=>sg(erodedTerrain(mountainShape(sourceStage*40+i),[-17,17,0,27,-17,17],6,false,T))),ml=mts.map(()=>[]);
    for(let z=0;z>-L;z-=rnd(110,190))for(const sd of[-1,1])ml[rint(0,2)].push({x:sd*rnd(230,430),z,ry:rnd(0,6),s:rnd(0.8,1.3)});ml.forEach((l,i)=>addInstances(mts[i],l));
    const hills=[0,1].map(i=>sg(erodedTerrain(mountainShape(sourceStage*50+i,false),[-17,17,0,27,-17,17],2.8,false,T))),hll=hills.map(()=>[]);
    for(let z=0;z>-L;z-=rnd(55,95))for(const sd of[-1,1])hll[rint(0,1)].push({x:sd*rnd(150,200),z,ry:rnd(0,6),s:rnd(0.8,1.2)});hll.forEach((l,i)=>addInstances(hills[i],l));
    const hs=[[.75,.25,.2],[.35,.4,.65],[.55,.4,.25]].map(c=>sg(voxGeo(houseShape(c,glow([1,.82,.4])),[-4,4,0,6,-3,3],2.2,false,T))),hl=hs.map(()=>[]);
    const church=sg(voxGeo(towerShape(glow([1,.9,.5]),false),[-3,3,0,16,-3,3],2.4,false,T)),cl3=[];
    for(let z=-80;z>-L;z-=rnd(110,180)){const sd=R()<0.5?-1:1,cx=sd*rnd(55,130);for(let i=0;i<rint(3,6);i++)hl[rint(0,2)].push({x:cx+rnd(-30,30),z:z+rnd(-30,30),ry:rint(0,3)*Math.PI/2});if(R()<0.35)cl3.push({x:cx,z})}
    hs.forEach((g,i)=>addInstances(g,hl[i]));addInstances(church,cl3);trees([pine()],30,145,10,0.35);
    for(let z=-500;z>-STAGE_LEN;z-=rnd(150,240))groundTarget(R()<0.5?'turret':'sam',rnd(-120,120),0,z);sideClouds(30,[90,170]);pathCl(800);
  }else if(k==='sea'){
    islands(6,480,[110,220],true);ships([200,400],380);sideClouds(40,[20,130]);pathCl(650);
    for(let z=-600;z>-STAGE_LEN;z-=rnd(380,620))groundTarget('destroyer',rnd(-120,120),0,z,{sway:rnd(20,45)});
  }else if(k==='sky'||k==='strato'){
    const cf=[0,1,2].map(i=>sg(cloudBank(155+i*13,58+i*5))),cfl=cf.map(()=>[]);
    for(let z=0;z>-L;z-=k==='sky'?16:30)for(let q=0;q<(k==='sky'?3:2);q++)cfl[rint(0,2)].push({x:rnd(-460,460),y:rnd(-14,-4),z:z-rnd(0,16),ry:rnd(0,6),s:rnd(0.8,1.8)});
    cf.forEach(g=>g.userData.ns=1);cfl.forEach((l,i)=>addInstances(cf[i],l));
    if(k==='sky'){const fi=[0,1,2].map(i=>sg(erodedTerrain(floatIslandShape(sourceStage*90+i),[-12,12,0,20,-12,12],3,false,T))),fl=fi.map(()=>[]);
      for(let z=-100;z>-L;z-=rnd(90,160)){const sd=R()<0.5?-1:1;fl[rint(0,2)].push({x:sd*rnd(110,360),y:rnd(10,120),z,ry:rnd(0,6),s:rnd(0.7,1.3)})}fl.forEach((l,i)=>addInstances(fi[i],l));pathCl(500);sideClouds(40,[20,160])}
    ringsFn([380,560],[30,90]);
  }else{
    const rg=[0,1,2,3].map(i=>sg(voxGeo(ruinShape(sourceStage*60+i),[-4,4,0,15,-4,4],3.2,false,T))),rl=rg.map(()=>[]);
    for(let z=0;z>-L;z-=11)for(const sd of[-1,1])if(R()<0.85)rl[rint(0,3)].push({x:sd*rnd(150,460),z:z-rnd(0,11),ry:rint(0,3)*Math.PI/2,s:rnd(0.9,1.5)});
    for(let z=0;z>-L;z-=30)if(R()<0.5)rl[rint(0,3)].push({x:rnd(-140,140),z,ry:rint(0,3)*Math.PI/2,s:rnd(0.4,0.6)});
    rl.forEach((l,i)=>addInstances(rg[i],l));
    for(let z=-450;z>-STAGE_LEN;z-=rnd(100,180))groundTarget(pick(['turret','tank','sam']),rnd(-130,130),0,z);
  }
  if(k==='city')sideClouds(32,[130,200]);clouds.forEach(g=>g.userData.ns=1);cl.forEach((l,i)=>addInstances(clouds[i],l));
}

/* =====================================================================
   적 패턴 — 화면 전역(좌우 끝·위아래·뒤·코너)에서
   ===================================================================== */
function mkEnemy(type,o){
  const mesh=new THREE.Mesh(GEO[type],enemySkin(type));mesh.userData.skin=mesh.material;mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);
  const e=Object.assign({type,mesh,t:0,pos:new V3(0,-999,0),prev:new V3(),vel:new V3(),fireT:rnd(0.5,2),alive:true,hidden:false,lvx:0,flash:0,flyby:false,lockN:0},o);
  if(type==='heli'){const r1=new THREE.Mesh(ROTOR_GEO,ROTOR_MAT),r2=new THREE.Mesh(ROTOR_GEO2,ROTOR_MAT);r1.scale.setScalar(0.5);r2.scale.setScalar(0.5);r1.position.y=r2.position.y=3.5;const g=new THREE.Group();g.add(r1,r2);mesh.add(g);e.rotor=g}
  if(e.isBoss||e.isMid)e.hp*=.5;
  e.maxhp=e.hp;enemies.push(e);
  if(!seenTypes.has(type)&&ENAME[type]){seenTypes.add(type);msg('NEW ENEMY · '+ENAME[type],'#9ac4ff')}
  return e;
}
const ENAME={walker:'WALKER MECH',mlrs:'ROCKET TRUCK',hopper:'HOPPER',m_whale:'SKY WHALE',m_manta:'STORM MANTA',m_beetle:'IRON BEETLE',fighter:'RED FIGHTER',fighter2:'INTERCEPTOR',ace:'ACE SQUADRON',stealth:'STEALTH',heli:'ATTACK HELI',kami:'KAMIKAZE DRONE',drone:'SWARM DRONE',bomber:'HEAVY BOMBER',turret:'AA GUN',tank:'TANK',sam:'SAM LAUNCHER',destroyer:'DESTROYER',boat:'PATROL BOAT'};
const hpF=(b=0)=>Math.max(1,Math.round((2+Math.floor((stageSourceNumber()-1)/2)+b)*DIF().ehp));
const rx=()=>rnd(-XB+10,XB-10),ry=()=>rnd(YMIN+8,YMAX-6);
const POOL=[
  [1,['headon','cross','swarm','flank','rear','top','cascade']],[2,['overtake','dive','drop','drop','quad','cascade']],[3,['heli','rise','surge','runner']],[4,['kamikaze','stealth','rear']],[5,['heavy','pincer','top','quad','runner']]];
function stagePool(){const out=[],air=['sky','strato','sea'].includes(curTheme.kind);for(const[s,list]of POOL)if(stageSourceNumber()>=s||loop>1)out.push(...list);if(!air)out.push('hopper','hopper');return out}
let dirAlert=null;const TOPY=150;
function alertDir(d,txt){dirAlert={d,txt,t:2.2};SFX.warn&&SFX.warn()}
function spawnEvent(ev){
  const sourceStage=stageSourceNumber();
  const g=n=>({n,k:0});
  switch(ev.type){
  case 'burner':speedMul=1.65;burnT=5.5;fovKick=14;msg('AFTERBURNER!!','#ffb040',true,2);SFX.burner();return;
  case 'headon':{const G=g(5),x0=rx(),y0=ry();
    for(let i=0;i<5;i++){const ox=(i-2)*16,oz=Math.abs(i-2)*14;mkEnemy(i%2?'fighter2':'fighter',{hp:hpF(),r:6,group:G,pts:100,exp:10,kind:'v',path:t=>{const z=-720+t*190+oz;return{x:x0+ox+Math.sin(t*1.6+i)*6,y:y0+Math.sin(t*2+i)*3,z,dead:z>90}}})}break}
  case 'cross':{const G=g(6),s=Math.random()<0.5?-1:1,y0=ry(),zc=rnd(-320,-130);
    for(let i=0;i<6;i++){const d=i*0.2,yo=(i-2.5)*9;mkEnemy('fighter2',{hp:hpF(),r:6,group:G,pts:100,exp:10,kind:'s',path:t=>{const u=t-d;if(u<0)return{x:-s*320,y:y0,z:zc,hide:true};const x=s*(-310+u*170);return{x,y:clamp(y0+yo,12,105)+Math.sin(u*2.5)*12,z:zc+u*18,dead:s*x>320}}})}break}
  case 'flank':{const G=g(5),s=Math.random()<0.5?-1:1,y0=ry();
    for(let i=0;i<5;i++){const d=i*0.18;mkEnemy('fighter',{hp:hpF(),r:6,group:G,pts:110,exp:11,kind:'s',path:t=>{const u=t-d;if(u<0)return{x:s*340,y:y0,z:-40,hide:true};
      return{x:s*(340-u*230),y:y0+(i-2)*7+Math.sin(u*3)*6,z:-40-u*170,dead:u>3.2}}})}break}
  case 'top':{const G=g(5);
    alertDir('above','ENEMIES ABOVE');
    for(let i=0;i<5;i++){const x0=clamp(P.x*0.5+(i-2)*42,-XB,XB),d=i*0.32,ty=rnd(55,85);mkEnemy('ace',{hp:hpF(1),r:6,group:G,pts:150,exp:14,kind:'d',fleeAt:6.5+i*0.2,path:t=>{const u=Math.max(0,t-d);
      const e=Math.min(1,u/1.8),ee=1-Math.pow(1-e,2.2);return{x:x0+Math.sin(u*1.6+i)*22,y:lerp(TOPY,ty,ee),z:-135-Math.abs(i-2)*10,hide:t<d,hold:u<1.2}}})}break}
  case 'cascade':{/* 상단 낙하 행렬: 화면 위 중앙에서 한 줄로 쏟아져 좌우로 갈라짐 */
    alertDir('above','ABOVE — CASCADE');const G=g(8);const x0=clamp(P.x*0.4,-50,50);
    for(let i=0;i<8;i++){const d=i*0.22,s=i%2?1:-1;mkEnemy(i%2?'fighter2':'fighter',{hp:hpF(),r:6,group:G,pts:110,exp:11,kind:'c',fleeAt:5.8,path:t=>{const u=t-d;if(u<0)return{x:x0,y:TOPY,z:-125,hide:true};
      const y=u<1.2?lerp(TOPY,60,u/1.2):60+Math.sin((u-1.2)*2)*8,x=x0+(u<1.2?0:s*Math.min(1,(u-1.2)/1.2)*(40+i*12));return{x,y,z:-125-i*4,hold:u<1}}})}
    break}
  case 'quad':{/* 4방향 포위: 좌·우·위·아래에서 동시에 들어와 원을 그리며 공격 후 사방으로 이탈 */
    alertDir('all','4방향 포위!');const G=g(12);
    const SIDES=[[-1,0],[1,0],[0,1],[0,-1]];
    SIDES.forEach(([sx,sy],q)=>{for(let i=0;i<3;i++){const d=q*0.25+i*0.18,ph=q*Math.PI/2+(i-1)*0.32;
      mkEnemy(q%2?'fighter2':'fighter',{hp:hpF(),r:6,group:G,pts:120,exp:12,kind:'q',fleeAt:7.5+i*0.3,path:t=>{const u=t-d;
        const sx0=sx*330,sy0=sy>0?TOPY:sy<0?-70:55,cx=clamp(P.x*0.3,-40,40),cyy=58;
        if(u<0)return{x:sx0,y:sy0,z:-125,hide:true};
        const e=Math.min(1,u/1.6),ee=1-Math.pow(1-e,3),a=ph+u*0.9,R=62-ee*6;
        const tx=cx+Math.cos(a)*R*1.25,ty=cyy+Math.sin(a)*R*0.55;
        return{x:lerp(sx0,tx,ee),y:clamp(lerp(sy0,ty,ee),YMIN,YMAX+40),z:-125+Math.sin(u*1.5+i)*10,hold:u<1.2}}})}});
    break}
  case 'rear':{/* 후방 기습: 카메라 뒤에서 추월해 앞으로 나가 돌아서 공격 → 이탈 */
    alertDir('rear','REAR ATTACK');const G=g(4);
    for(let i=0;i<4;i++){const side=i%2?1:-1,d=i*0.28,x0=clamp(P.x+side*rnd(42,70),-XB,XB),y0=clamp(P.y+(i<2?-1:1)*rnd(8,22),14,104);
      mkEnemy('ace',{hp:hpF(1),r:6,group:G,pts:160,exp:15,kind:'r',fleeAt:7+i*0.3,path:t=>{const u=t-d;if(u<0)return{x:x0,y:y0,z:180,hide:true};
        let z,x=x0,y=y0;if(u<2)z=180-u*172;else{z=-165+Math.sin(u*1.4+i)*16;x=x0-side*Math.min(1,(u-2)/1.5)*30+Math.sin(u+i)*20}
        return{x,y:y+Math.sin(u*2+i)*5,z,hold:z>-60}}})}
    break}
  case 'drop':{/* 상공 강하: 머리 위에서 수직으로 떨어지다 급상승 이탈 */
    alertDir('above','ABOVE');const G=g(5);
    for(let i=0;i<5;i++){const x0=clamp(P.x+(i-2)*34+rnd(-8,8),-XB,XB),d=i*0.3,zb=-110-i*12;
      mkEnemy('fighter',{hp:hpF(),r:6,group:G,pts:120,exp:12,kind:'dr',fleeAt:5.6,path:t=>{const u=t-d;if(u<0)return{x:x0,y:TOPY,z:zb,hide:true};
        const y=u<1.1?TOPY-(TOPY-32)*Math.pow(u/1.1,1.6):32+(1-Math.exp(-(u-1.1)*2))*30+Math.sin((u-1.1)*2)*5;return{x:x0+Math.sin(u*2+i)*8,y,z:zb,hold:u<0.9}}})}
    break}
  case 'surge':{/* 하방 급상승: 지면·해면 아래에서 솟구쳐 올라와 공격 */
    alertDir('below','BELOW');const G=g(5);const air=['sky','strato'].includes(curTheme.kind);
    for(let i=0;i<5;i++){const x0=clamp(P.x+(i-2)*30+rnd(-6,6),-XB,XB),d=i*0.2,zb=-120-Math.abs(i-2)*16,y0=air?-80:-25;
      mkEnemy('fighter2',{hp:hpF(),r:6,group:G,pts:120,exp:12,kind:'su',fleeAt:5.5,path:t=>{const u=t-d;if(u<0)return{x:x0,y:y0,z:zb,hide:true};
        if(!air&&u<0.5&&Math.random()<0.5)emit(1,x0+rnd(-4,4),1,scrollZ+zb+rnd(-4,4),rnd(-10,10),rnd(20,50),-speed*0.6,0.7,3,8,0.6,[.6,.55,.5]);
        const y=u<1.2?y0+(1-Math.pow(1-u/1.2,2))*(70-y0):70+Math.sin((u-1.2)*1.8+i)*10;return{x:x0+Math.sin(u*1.7+i)*14,y,z:zb,hold:u<1}}})}
    break}
  case 'runner':{/* 도주 수송기: 앞에서 달아나는 목표. 놓치면 탈출 */
    alertDir('front','RUNNER — 도주하는 수송기를 격추하라');
    const x0=rnd(-60,60);
    const rn=mkEnemy('bomber',{hp:Math.round((10+sourceStage*4)*DIF().ehp),r:12,pts:1500,exp:60,kind:'run',runner:true,path:t=>{const z=-140-t*t*9-t*14,x=x0+Math.sin(t*1.1)*70,y=50+Math.sin(t*0.8)*24;
      if(Math.random()<0.4)emit(0,x+rnd(-3,3),y,scrollZ+z+10,0,0,-speed*0.7,0.3,3,1,1);return{x,y,z,dead:t>9,hold:true}}});
    for(let i=0;i<2;i++){const s=i?1:-1;mkEnemy('fighter2',{hp:hpF(),r:6,pts:120,exp:10,kind:'s',fleeAt:6,path:t=>{const r=rn.path(t);return{x:r.x+s*30,y:r.y+6,z:r.z+24,dead:!rn.alive&&t>1||r.dead}}})}
    break}
  case 'overtake':{const G=g(4);
    for(let i=0;i<4;i++){const side=i%2?1:-1,x0=clamp(P.x+side*rnd(30,120),-XB,XB),y0=clamp(P.y+(i<2?-1:1)*rnd(10,35),12,105),d=i*0.35;
      mkEnemy('ace',{hp:hpF(1),r:6,group:G,pts:150,exp:14,kind:'o',path:t=>{const u=Math.max(0,t-d);let z;if(u<1.8)z=80-u*155;else if(u<6)z=-200+Math.sin(u*1.3+i)*14;else z=-200-(u-6)*170;
        const sp=u<1.8?0.2:1;return{x:x0+Math.sin(u*1.1+i)*40*sp,y:y0+(u<1.8?0:Math.sin(u*1.6+i)*12),z,dead:z<-950,hold:u>=1.8&&u<6,hide:t<d}}})}msg('BOGEYS ON YOUR SIX!','#ff9a7a');break}
  case 'dive':{const G=g(4);
    for(let i=0;i<4;i++){const x0=rx(),d=i*0.2;mkEnemy('fighter',{hp:hpF(),r:6,group:G,pts:120,exp:12,kind:'d',path:t=>{const u=Math.max(0,t-d);const y=u<1.4?200-u*125:u<2.6?25+Math.sin((u-1.4)*2.6)*6:25+(u-2.6)*80;
      return{x:x0+Math.sin(u*1.8)*25,y,z:-280+u*35,dead:y>240,hide:t<d}}})}break}
  case 'rise':{const G=g(4);
    for(let i=0;i<4;i++){const x0=rx(),d=i*0.22;mkEnemy('fighter2',{hp:hpF(),r:6,group:G,pts:120,exp:12,kind:'d',path:t=>{const u=Math.max(0,t-d);const y=-8+u*72;return{x:x0+Math.sin(u*3+i)*18,y,z:-320+u*45,dead:y>240,hide:t<d||y<1}}})}break}
  case 'swarm':{const G=g(10),x0=rx(),y0=ry(),dir=Math.random()<0.5?-1:1,R=rnd(28,45);
    for(let i=0;i<10;i++){const ph=i/10*Math.PI*2;mkEnemy('drone',{hp:Math.max(1,Math.round(DIF().ehp)),r:4.5,group:G,pts:50,exp:5,kind:'w',path:t=>{const z=-820+t*170,a=t*2.6*dir+ph;return{x:x0+Math.cos(a)*R,y:clamp(y0+Math.sin(a)*R*0.7,8,112),z,dead:z>90}}})}break}
  case 'heli':{const G=g(3);
    for(let i=0;i<3;i++){const s=i===1?(Math.random()<0.5?-1:1):(i===0?-1:1),tx=s*rnd(50,130),ty=ry(),tz=rnd(-260,-170);
      mkEnemy('heli',{hp:hpF(3),r:7,group:G,pts:250,exp:20,kind:'h2',path:t=>{const e=Math.min(1,t/2);let x=lerp(s*330,tx,1-Math.pow(1-e,2)),y=ty,z=tz;if(t>9){y=ty+(t-9)*60;}
        return{x:x+Math.sin(t*1.3+i)*8,y:y+Math.sin(t*2)*3,z,dead:y>240,hold:t>2&&t<9}}})}break}
  case 'kamikaze':{
    for(let i=0;i<4;i++){const sx=i%2?1:-1,sy=i<2?20:100;let st=null;
      mkEnemy('kami',{hp:hpF(),r:4.5,pts:120,exp:10,kind:'k',path:(t)=>{if(!st)st={x:sx*230,y:sy,z:-520,lt:t};const sdt=Math.max(0,t-st.lt);st.lt=t;if(t>0.6){const dx=P.x-st.x,dy=P.y-st.y,dz=0-st.z,l=Math.hypot(dx,dy,dz)||1,sp=150*Math.min(1,(t-0.6)*1.5)*DIF().bspd;st.x+=dx/l*sp*sdt;st.y+=dy/l*sp*sdt;st.z+=dz/l*sp*sdt}
        return{x:st.x,y:st.y,z:st.z,dead:st.z>60}}})}msg('KAMIKAZE INCOMING!','#ff9a7a');break}
  case 'stealth':{
    for(let i=0;i<3;i++){const s=i%2?1:-1,d=i*0.4;mkEnemy('stealth',{hp:hpF(1),r:7,pts:200,exp:18,kind:'d',path:t=>{const u=Math.max(0,t-d);return{x:s*(160-u*170),y:105-u*38+Math.sin(u*4)*6,z:90-u*420,dead:u>2.4,hide:t<d}}})}break}
  case 'heavy':{const x0=rnd(-90,90),y0=ry();
    const hb=mkEnemy('bomber',{hp:Math.round((26+sourceStage*7)*DIF().ehp),r:13,pts:800,exp:60,kind:'hb',drop:true,path:t=>{let z;if(t<3.5)z=-650+t*120;else if(t<13)z=-230+Math.sin(t*0.8)*12;else z=-230-(t-13)*120;
      return{x:x0+Math.sin(t*0.5)*60,y:y0+Math.sin(t*0.9)*6,z,dead:z<-950,hold:t>=3.5&&t<13}}});
    for(let i=0;i<2;i++)mkEnemy('fighter2',{hp:hpF(),r:6,pts:100,exp:10,kind:'s',path:t=>{const a=t*1.4+i*Math.PI,r=hb.path(t);return{x:r.x+Math.cos(a)*34,y:r.y+Math.sin(a)*14,z:r.z+Math.sin(a)*20,dead:r.dead}}});break}
  case 'hopper':{const G=g(5);
    for(let i=0;i<5;i++){const x0=rx(),z0=-rnd(300,460),d=i*0.35,tx=clamp(P.x+rnd(-40,40),-XB,XB);
      mkEnemy('hopper',{hp:hpF(1),r:6,group:G,pts:180,exp:14,kind:'hop',path:t=>{const u=Math.max(0,t-d);const ph=u%2.3;const y=Math.max(0,115*ph-50*ph*ph);
        const x=lerp(x0,tx,Math.min(1,u/4.6));return{x,y,z:z0+u*32,dead:u>4.6||z0+u*32>70,hide:t<d}}})}
    msg('HOPPERS!','#ff9a7a');break}
  case 'midboss':{const M=MIDS[(sourceStage-1)%MIDS.length];
    const m=mkEnemy(M.geo,{hp:Math.round(320*Math.sqrt(M.hp/150)*powerK()*(1+(sourceStage-1)*0.03)*(1+(loop-1)*0.5)*DIF().ehp),r:M.r,pts:3000+sourceStage*500,exp:120,kind:'mid',isMid:true,mdef:M,mt:M.pats.map(p=>p[1]*0.5+1),
      path:t=>{const e=Math.min(1,t/4);let z=-950+e*740,y=M.y+Math.sin(t*0.7)*10,x=Math.sin((t-4)*0.5)*65*e;if(t>18){const u=t-18;y+=u*45;z-=u*140}return{x,y,z,dead:t>22}}});
    midE=m;addWeak(m,2);msg('CAUTION!! '+M.name,'#ffb040',true,2.6);SFX.warn();break}
  case 'pincer':{const G=g(6);
    for(let i=0;i<6;i++){const s=i%2?1:-1,d=(i>>1)*0.3;mkEnemy('ace',{hp:hpF(),r:6,group:G,pts:120,exp:12,kind:'s',path:t=>{const u=t-d;if(u<0)return{x:s*320,y:50,z:-150,hide:true};const x=s*(310-u*190);
      return{x,y:20+(i>>1)*35+Math.sin(u*3)*8,z:-160-u*30+Math.abs(x)*0.2,dead:-s*x>320}}})}msg('PINCER ATTACK!','#ff9a7a');break}
  }
}
// The source stays with the attack even if several bosses share a pattern.
function bossAreaDamage(base,owner){return owner?.isBoss?base*11/10:base}
function orb(from,dir,spd,owner=null,area=false){eOrb.push({owner,dmg:area?bossAreaDamage(20,owner):20,pos:from.clone(),prev:from.clone(),vel:dir.clone().multiplyScalar(spd).add(tB.set(0,0,-speed)),l:0})}
function aimDir(from,spread=0,vs=0){tA.copy(ppos).sub(from).normalize();if(spread)tA.applyAxisAngle(UPV,spread);if(vs){tA.y+=vs;tA.normalize()}return tA}
function fan(from,n,step,spd,owner=null,area=false){for(let i=0;i<n;i++)orb(from,aimDir(from,(i-(n-1)/2)*step),spd,owner,area)}
const orbSpd=()=>(76+stageSourceNumber()*5)*DIF().bspd,fireK=()=>(1+stageSourceNumber()*0.08)*DIF().fire;
function launchEMsl(from,dir,owner=null){if(emsl.length>=6)return;emsl.push({owner,pos:from.clone(),prev:from.clone(),dir:dir.clone().normalize(),l:0,hp:1})}

/* =====================================================================
   보스 9종
   ===================================================================== */
/* 위험 구역: 플레이어 앞 평면에 예고(빨간 경고) → 발동(폭발). rect / disc / safe(원 밖이 전부 위험) */
let zones=[];
const ZTEX=(()=>{const c=document.createElement('canvas');c.width=c.height=32;const g=c.getContext('2d');g.fillStyle='rgba(255,40,30,.55)';g.fillRect(0,0,32,32);
  g.fillStyle='rgba(20,0,0,.55)';for(let i=-32;i<32;i+=8){g.beginPath();g.moveTo(i,0);g.lineTo(i+4,0);g.lineTo(i+36,32);g.lineTo(i+32,32);g.fill()}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=t.minFilter=THREE.NearestFilter;return t})();
/* 장판: 맵 바닥 전체에 깔리는 붉은 공격 범위. 경고 동안 안전 지대(범위 밖·쉴드 돔 안)로 피한다 */
const ZGEO={flat:new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),disc:new THREE.CircleGeometry(1,28).rotateX(-Math.PI/2),ring:new THREE.RingGeometry(0.93,1,32).rotateX(-Math.PI/2),dome:new THREE.SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI/2)};
const ZLEN=1000,ZBACK=140;
const zGround=()=>['sky','strato'].includes(curTheme.kind)?YMIN-8:0.6;
function zMat(rep){const m=new THREE.MeshBasicMaterial({map:ZTEX.clone(),color:0xff3020,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,fog:false,polygonOffset:true,polygonOffsetFactor:-2});m.map.needsUpdate=true;if(rep)m.map.repeat.set(rep[0],rep[1]);return m}
function addZone(o){
  const z=Object.assign({kind:'lane',x:0,w:60,r:24,warn:1.7,fire:0.9,delay:0,src:'ground',dmg:30,t:0,hit:false,fired:false,safe:[]},o);
  z.dmg=bossAreaDamage(z.dmg,z.owner);
  z.mesh=new THREE.Group();z.mesh.visible=false;scene.add(z.mesh);z.mats=[];
  const W=z.kind==='field'?XB*2+80:z.w;
  if(z.kind==='disc'){const m=zMat([z.r/8,z.r/8]);const d=new THREE.Mesh(ZGEO.disc,m);d.scale.setScalar(z.r);z.mesh.add(d);z.mats.push(m);
    const rm=new THREE.MeshBasicMaterial({color:0xff6040,transparent:true,depthWrite:false,fog:false});const rg=new THREE.Mesh(ZGEO.ring,rm);rg.scale.setScalar(z.r);rg.position.y=0.2;z.mesh.add(rg);z.edge=[rm]}
  else{const m=zMat([W/16,ZLEN/16]);const p=new THREE.Mesh(ZGEO.flat,m);p.scale.set(W,1,ZLEN);p.position.z=-ZLEN/2+ZBACK;z.mesh.add(p);z.mats.push(m);z.edge=[];
    if(z.kind==='lane')for(const sd of[-1,1]){const em=new THREE.MeshBasicMaterial({color:0xff6040,transparent:true,depthWrite:false,fog:false});const e=new THREE.Mesh(ZGEO.flat,em);e.scale.set(2.2,1,ZLEN);e.position.set(sd*W/2,0.2,-ZLEN/2+ZBACK);z.mesh.add(e);z.edge.push(em)}}
  if(z.kind==='field'){z.domes=z.safe.map(sf=>{const g=new THREE.Group();
      const pad=new THREE.Mesh(ZGEO.disc,new THREE.MeshBasicMaterial({color:0x30ff80,transparent:true,opacity:.55,depthWrite:false,fog:false,polygonOffset:true,polygonOffsetFactor:-4}));pad.scale.setScalar(sf.r);pad.position.y=0.3;
      const dm=new THREE.MeshBasicMaterial({color:0x60ffb0,transparent:true,opacity:.18,depthWrite:false,side:THREE.DoubleSide,fog:false});const dome=new THREE.Mesh(ZGEO.dome,dm);dome.scale.setScalar(sf.r);
      const wm=new THREE.MeshBasicMaterial({color:0xa0ffd0,wireframe:true,transparent:true,opacity:.55,fog:false});const wire=new THREE.Mesh(ZGEO.dome,wm);wire.scale.setScalar(sf.r*1.01);
      const post=new THREE.Mesh(new THREE.BoxGeometry(3,8,3),new THREE.MeshBasicMaterial({color:0x40ffa0}));post.position.y=4;
      g.add(pad,dome,wire,post);g.position.x=sf.x;z.mesh.add(g);return{g,dm,wm,sf}})}
  zones.push(z);return z;
}
function zoneHits(z){const gy=zGround();
  if(z.kind==='lane')return Math.abs(P.x-z.x)<z.w/2;
  if(z.kind==='disc')return Math.abs(P.x-z.x)<z.r;
  return!z.safe.some(sf=>Math.hypot(P.x-sf.x,(P.y-gy)*0.9)<sf.r)}
let zoneBeep=0,omegaFlash=0,zoneHUD=null;
/* 거대 입자포: 장판이 터질 때 실제로 쏟아지는 빔. 좌표는 scrollZ 기준 상대값으로 보관 */
const BEAM_GEO=new THREE.CylinderGeometry(1,1,1,14,1,true),ORB_GEO=new THREE.SphereGeometry(1,14,10);
const bMat=c=>new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,side:THREE.DoubleSide});
let beams=[];
function zSource(owner){const h=owner?.alive?owner:null;return h?tA.set(h.pos.x,h.pos.y,h.pos.z-scrollZ).clone():null}
function addBeam(a,b,r,o={}){const g=new THREE.Group(),cm=bMat(o.core||0xfff6e8),gm=bMat(o.col||0xff5030),hm=bMat(o.col||0xff5030);
  const core=new THREE.Mesh(BEAM_GEO,cm),glow=new THREE.Mesh(BEAM_GEO,gm),halo=new THREE.Mesh(BEAM_GEO,hm);g.add(halo,glow,core);
  const hit=new THREE.Mesh(ORB_GEO,bMat(o.col||0xff7040));g.add(hit);scene.add(g);
  const bm={owner:o.owner,g,core,glow,halo,hit,cm,gm,hm,a:a.clone(),b:b.clone(),r,t:-(o.delay||0),life:o.life||0.85};beams.push(bm);g.visible=false;return bm}
function updBeams(dt){
  for(const B of beams){B.t+=dt;if(B.t<0)continue;
    if(!B.on){B.on=true;B.g.visible=true;if(AU.ctx&&AU.on){const a=AU.ctx.currentTime;pulse(a,1900,0.6,0.06,.125,AU.sfx,90);nz(a,0.7,0.22,'bandpass',2600,300,AU.sfx)}shake=Math.max(shake,0.45);hitFlash=Math.max(hitFlash,0.12)}
    const k=B.t/B.life,grow=Math.min(1,B.t/0.07),fade=k>0.7?Math.max(0,1-(k-0.7)/0.3):1,fl=0.85+Math.random()*0.3;
    const A=tB.set(B.a.x,B.a.y,B.a.z+scrollZ),E=tC.set(B.b.x,B.b.y,B.b.z+scrollZ),len=A.distanceTo(E);
    B.g.position.copy(A).add(E).multiplyScalar(0.5);tA.subVectors(E,A).normalize();B.g.quaternion.setFromUnitVectors(UPV,tA);
    const r=B.r*grow*(0.4+0.6*fade);B.core.scale.set(r*0.42*fl,len,r*0.42*fl);B.glow.scale.set(r*0.8,len,r*0.8);B.halo.scale.set(r*1.25*fl,len,r*1.25*fl);
    const near=Math.min(1,Math.abs(B.b.z)/60+0.35);B.cm.opacity=0.95*fade;B.gm.opacity=0.6*fade*near;B.hm.opacity=0.18*fade*near;B.gm.color.setHSL(0.02+0.03*Math.sin(B.t*40),1,0.55);
    B.hit.position.set(0,-len/2,0);B.hit.scale.setScalar(r*1.6*fl);B.hit.material.opacity=0.8*fade;
    if(Math.random()<0.7){const sp=tC.set(B.b.x+rnd(-r,r),B.b.y,B.b.z+scrollZ+rnd(-r,r));emit(2,sp.x,sp.y+1,sp.z,rnd(-60,60),rnd(30,110),rnd(-60,60)-speed*0.5,0.4,2.2,0.8,0)}
    if(B.t>B.life){B.dead=true;scene.remove(B.g)}}
  beams=beams.filter(b=>!b.dead)}
function clearBeams(){for(const b of beams)scene.remove(b.g);beams=[];for(const z of zones)if(z.aim)scene.remove(z.aim.g)}
function fireBeams(z,gy){const src=zSource(z.owner),sky=z.src==='sky'||!src,col=z.kind==='field'?0xffa030:sky?0xff40b0:0xff5030;
  if(z.kind==='lane'){
    if(!sky){addBeam(src,new V3(z.x,gy+4,60),z.w*0.48,{owner:z.owner,col,life:0.95})}
    else for(let i=0;i<6;i++){const zz=-430+i*80;addBeam(new V3(z.x+rnd(-6,6),gy+520,zz-60),new V3(z.x,gy,zz),z.w*0.46,{owner:z.owner,col,delay:i*0.05})}}
  else if(z.kind==='disc'){addBeam(new V3(z.x,gy+560,-40),new V3(z.x,gy,0),z.r*1.05,{owner:z.owner,col:sky?col:0xff6030,life:0.9})}
  else{let n=0;for(let k=0;k<40&&n<16;k++){const x=rnd(-XB-20,XB+20);if(z.safe.some(sf=>Math.abs(x-sf.x)<sf.r+20))continue;n++;const zz=-rnd(40,520);addBeam(new V3(x+rnd(-20,20),gy+560,zz-80),new V3(x,gy,zz),rnd(20,30),{owner:z.owner,col,delay:rnd(0,0.35),life:0.8})}
    for(const sd of[-1,1]){const x=sd*(XB-10);if(!z.safe.some(sf=>Math.abs(x-sf.x)<sf.r+25))addBeam(new V3(x,gy+560,-10),new V3(x,gy,5),26,{owner:z.owner,col,delay:0.1})}
    if(src){let tx=0;for(let k=0;k<12;k++){tx=rnd(-XB,XB);if(!z.safe.some(sf=>Math.abs(tx-sf.x)<sf.r+30))break}addBeam(src,new V3(tx,gy+4,40),34,{owner:z.owner,col:0xff5030,life:1.1})}}
}
/* 경고 중: 발사원에서 장판으로 향하는 조준선 + 충전구 */
function updAim(z,t,gy){const src=zSource(z.owner);if(!src&&z.src!=='sky')return;
  if(!z.aim){const g=new THREE.Group(),lm=bMat(0xff4030),om=bMat(0xffd0a0),line=new THREE.Mesh(BEAM_GEO,lm),orb=new THREE.Mesh(ORB_GEO,om);g.add(line,orb);scene.add(g);z.aim={g,line,orb,lm,om}}
  const A=z.aim,k=t/z.warn,fast=k>0.6;
  const S=src?tA.set(src.x,src.y,src.z+scrollZ):tA.set(z.kind==='field'?0:z.x,gy+300,scrollZ-260);
  const T=tB.set(z.kind==='field'?P.x:z.x,gy+2,scrollZ-(z.kind==='lane'?120:0));const len=S.distanceTo(T);
  A.line.position.copy(S).add(T).multiplyScalar(0.5);tC.subVectors(T,S).normalize();A.line.quaternion.setFromUnitVectors(UPV,tC);
  const w=(0.5+k*1.6)*(Math.floor(t*(fast?16:7))%2?1:0.5);A.line.scale.set(w,len,w);A.lm.opacity=0.35+0.4*k;
  A.orb.position.copy(S);A.orb.scale.setScalar(3+k*k*(z.kind==='field'?26:16)+Math.random()*2);A.om.opacity=0.5+0.5*k;
  if(Math.random()<0.6){const a=rnd(0,6.28),d=rnd(20,40);emit(2,S.x+Math.cos(a)*d,S.y+Math.sin(a)*d,S.z+rnd(-10,10),-Math.cos(a)*d*3,-Math.sin(a)*d*3,0,0.3,1.6,0.6,0)}
  if(!z.chg&&AU.ctx&&AU.on){z.chg=1;pulse(AU.ctx.currentTime,120,z.warn,0.045,.25,AU.sfx,1400)}}
function updZones(dt){
  zoneBeep-=dt;zoneHUD=null;const gy=zGround();
  for(const z of zones){
    z.t+=dt;const t=z.t-z.delay;if(t<0)continue;
    if(!z.shown){z.shown=true;z.mesh.visible=true;if(z.track)z.x=clamp(P.x,-XB,XB);if(z.kind!=='field')z.mesh.position.x=z.x;SFX.warn&&SFX.warn()}
    z.mesh.position.y=gy;z.mesh.position.z=scrollZ;
    if(t<z.warn){const fast=t>z.warn*0.6,bl=Math.floor(t*(fast?12:5))%2;for(const m of z.mats){m.opacity=bl?1:0.62;m.color.setHex(bl?0xff4030:0xff2010);m.map.offset.y=-t*0.6}for(const m of z.edge)m.opacity=bl?1:0.5;
      if(z.domes)for(const d of z.domes){const inD=Math.hypot(P.x-d.sf.x,(P.y-gy)*0.9)<d.sf.r;d.dm.opacity=inD?0.05:0.16+0.1*Math.sin(t*10);d.wm.opacity=inD?0.25:0.6}
      if(zoneBeep<=0){zoneBeep=fast?0.12:0.25;SFX.alarm()}
      const danger=zoneHits(z);if(!zoneHUD||danger)zoneHUD={z,danger,left:z.warn-t};updAim(z,t,gy)}
    else{if(!z.fired){z.fired=true;for(const m of z.mats){m.map=null;m.color.setHex(0xffd8a0);m.needsUpdate=true}zoneBurst(z,gy);fireBeams(z,gy);if(z.aim){scene.remove(z.aim.g);z.aim=null}if(z.kind==='field')omegaFlash=0.45}
      const f=(t-z.warn)/z.fire;for(const m of z.mats)m.opacity=0.9*(1-f);for(const m of z.edge)m.opacity=1-f;
      if(z.domes)for(const d of z.domes){d.dm.opacity=0.35*(1-f)+0.05;d.dm.color.setHex(0xc0fff0)}
      if(!z.hit&&P.alive&&state==='play'&&zoneHits(z)){z.hit=true;damage(z.dmg);msg('DIRECT HIT!','#ff6a5a')}
      else if(!z.hit&&!z.ok&&state==='play'){z.ok=true;if(z.kind==='field'){score+=500;msg('SHELTERED! +500','#7affd8',false,1.4)}}
      if(t>z.warn+z.fire){z.dead=true;scene.remove(z.mesh);if(z.aim)scene.remove(z.aim.g)}}
  }
  zones=zones.filter(z=>!z.dead);omegaFlash=Math.max(0,omegaFlash-dt*1.6);updBeams(dt);
}
function zoneBurst(z,gy){
  SFX.boom(4,null);shake=Math.max(shake,z.kind==='field'?0.8:0.4);const sky=z.src==='sky';
  const spot=(x,zz)=>{if(sky)emit(0,x,gy+rnd(60,120),zz,rnd(-4,4),-rnd(150,220),-speed*0.6,rnd(0.5,0.8),rnd(3,5),1,1);else emit(0,x,gy+1,zz,rnd(-6,6),rnd(90,170),-speed*0.6,rnd(0.5,0.9),rnd(3,5),1,1)};
  const xs=z.kind==='field'?[-XB-30,XB+30]:z.kind==='disc'?[z.x-z.r,z.x+z.r]:[z.x-z.w/2,z.x+z.w/2];
  const n=z.kind==='field'?150:z.kind==='disc'?40:Math.min(90,Math.round((xs[1]-xs[0])*0.9));
  for(let i=0;i<n;i++){const x=rnd(xs[0],xs[1]),zz=scrollZ-rnd(-20,420);if(z.safe.some(sf=>Math.abs(x-sf.x)<sf.r))continue;if(z.kind==='disc'&&Math.abs(zz-scrollZ)>z.r*1.4)continue;spot(x,zz)}
  for(let i=0;i<14;i++){const x=rnd(xs[0],xs[1]);if(z.safe.some(sf=>Math.abs(x-sf.x)<sf.r))continue;emit(1,x,gy+rnd(2,20),scrollZ-rnd(0,200),rnd(-8,8),rnd(10,30),-speed*0.5,rnd(1.2,2),5,14,0.5,[.3,.25,.25])}
}
function farSpot(r,minD){let x;for(let k=0;k<20;k++){x=rnd(-XB+r,XB-r);if(Math.abs(x-P.x)>minD)break}return x}
/* 보스 필살기: 전부 바닥 장판 */
const ULT={
  megaCannon(e){[0,0.95,1.9].forEach(d=>addZone({owner:e,kind:'lane',track:true,w:56,delay:d,warn:1.5}))},
  carpet(e){const s=P.x<0?-1:1;addZone({owner:e,kind:'lane',x:s*55,w:200,warn:1.8});addZone({owner:e,kind:'lane',x:-s*55,w:200,delay:1.9,warn:1.6,src:'sky'})},
  curtain(e){const d=Math.random()<0.5?1:-1;[-112,-40,32,104].forEach((x,i)=>addZone({owner:e,kind:'lane',x:d*x,w:76,delay:i*0.55,warn:1.4,src:'sky'}))},
  slash(e){addZone({owner:e,kind:'lane',x:-72,w:150,warn:1.6,src:'sky'});addZone({owner:e,kind:'lane',x:72,w:150,delay:1.4,warn:1.5,src:'sky'});addZone({owner:e,kind:'lane',x:0,w:110,delay:2.8,warn:1.4,src:'sky'})},
  quake(e){const a=farSpot(34,30);let b=farSpot(34,30);if(Math.abs(b-a)<90)b=clamp(a+(a>0?-150:150),-XB+34,XB-34);addZone({owner:e,kind:'field',safe:[{x:a,r:34},{x:b,r:34}],warn:2.4,dmg:35})},
  tidal(e){addZone({owner:e,kind:'disc',track:true,r:44,warn:1.5});addZone({owner:e,kind:'disc',track:true,r:40,delay:1.6,warn:1.3})},
  lance(e){addZone({owner:e,kind:'disc',track:true,r:24,warn:1.3,src:'sky'});for(let i=0;i<5;i++)addZone({owner:e,kind:'disc',x:rnd(-XB,XB),r:24,delay:0.35+i*0.3,warn:1.3,src:'sky'})},
  buster(e){addZone({owner:e,kind:'lane',track:true,w:84,warn:1.5,dmg:40});addZone({owner:e,kind:'field',safe:[{x:farSpot(32,70),r:32}],delay:1.6,warn:2.4,dmg:40,src:'sky'})},
  omega(e){addZone({owner:e,kind:'field',safe:[{x:farSpot(30,90),r:30}],warn:2.8,fire:0.9,dmg:45,src:'sky'})}
};
const MIDS=[
  {name:'SKY WHALE',geo:'m_whale',r:30,hp:150,y:70,pats:[['rain',0.4],['ring',3.6],['missiles',6],['zone',6.5]]},
  {name:'STORM MANTA',geo:'m_manta',r:30,hp:140,y:62,pats:[['fan',1.3],['sweep',4.2],['wall',5],['zone',6]]},
  {name:'IRON BEETLE',geo:'m_beetle',r:26,hp:170,y:58,pats:[['burst',1.8],['missiles',5],['spiral',0.16],['zone',6.2]]}];
let midE=null;
const BOSSES=[
  {name:'HEAVY TANK "BULLDOG"',ult:'megaCannon',ultName:'MEGA CANNON',geo:'b_tank',kind:'ground',r:20,hp:220,coreY:15,pats:[['fan',1.3],['burst',2],['wall',3.4]],extra:['missiles',5]},
  {name:'LAND CRAWLER "MAMMOTH"',ult:'carpet',ultName:'CARPET BOMBARD',geo:'b_crawler',kind:'ground',r:28,hp:280,coreY:18,pats:[['wall',3],['fan',1.2],['missiles',5]],extra:['ring',3.6]},
  {name:'GIANT BOMBER "CONDOR"',ult:'curtain',ultName:'BOMB CURTAIN',geo:'b_condor',kind:'air',r:36,hp:320,y:64,coreY:0,pats:[['rain',0.28],['fan',1.6],['missiles',5]],extra:['ring',3.6]},
  {name:'FLYING WING "NIGHTHAWK"',ult:'slash',ultName:'SONIC SLASH',geo:'b_wing',kind:'air',r:32,hp:360,y:60,coreY:0,pats:[['wall',2.4],['spiral',0.13],['fan',1.5]],extra:['missiles',4]},
  {name:'WALKER MECH "GOLEM"',ult:'quake',ultName:'GROUND QUAKE',geo:'r_golem',kind:'stand',robot:true,walk:true,r:16,hp:400,meshY:0,coreY:25.5*1.5,pats:[['burst',1.6],['sweep',4],['ring',3.8]],extra:['missiles',4.5]},
  {name:'SEA ROBOT "TRITON"',ult:'tidal',ultName:'TIDAL BEAM',geo:'r_triton',kind:'stand',robot:true,splash:true,r:22,hp:440,meshY:-14*2.2,coreY:25.5*2.2,pats:[['sweep',3.4],['fan',1.3],['ring',4]],extra:['missiles',4]},
  {name:'GIANT ROBOT "VALKYRIE"',ult:'lance',ultName:'SKY LANCE',geo:'r_valk',kind:'air',robot:true,r:22,hp:500,y:60,coreY:25.5*2.2,pats:[['spiral',0.12],['sweep',3.6],['missiles',4.4]],extra:['wall',3]},
  {name:'GIANT ROBOT "TITAN"',ult:'buster',ultName:'GIGA BUSTER',geo:'r_titan',kind:'air',robot:true,r:30,hp:580,y:62,coreY:25.5*3.2,zEnd:-250,pats:[['sweep',3],['fan',1.2],['missiles',3.8],['ring',3.6]],extra:['spiral',0.12]},
  {name:'COLOSSUS "OMEGA"',ult:'omega',ultName:'OMEGA FLARE',geo:'r_colossus',kind:'stand',robot:true,walk:true,r:58,hp:720,meshY:0,coreY:25.5*6.5,zEnd:-360,sway:30,ymax:250,scale:1.25,pats:[['sweep',2.8],['fan',1.1],['missiles',3.2],['ring',3.4]],extra:['wall',2.6],final:true}];
const PAT={
  fan(e){fan(e.pos,e.hp<e.maxhp*0.5?7:5,0.13,orbSpd(),e,true)},
  ring(e){const n=16,ph=Math.random();for(let i=0;i<n;i++){const a=(i+ph)/n*Math.PI*2;tA.set(Math.cos(a)*0.6,Math.sin(a)*0.6,1).normalize();orb(e.pos,tA,orbSpd()*0.75,e,true)}},
  spiral(e){e.spi=(e.spi||0)+0.42;for(let k=0;k<3;k++){const a=e.spi+k*2.094;tA.set(Math.cos(a)*0.7,Math.sin(a)*0.5,1).normalize();orb(e.pos,tA,orbSpd()*0.7,e,true)}},
  rain(e){tA.set(rnd(-0.6,0.6),rnd(-0.4,0.2),1).normalize();orb(tB.copy(e.pos).add(tC.set(rnd(-20,20),0,0)),tA,orbSpd()*0.65,e,true)},
  burst(e){e.burstShots=2;e.burstDelay=.14;fan(e.pos,3,0.06,orbSpd()*1.15,e)},
  wall(e){const gap=rnd(-XB+40,XB-40),gy=rnd(25,90);for(let x=-XB;x<=XB;x+=14){if(Math.abs(x-gap)<26)continue;tA.set((x-e.pos.x)/420,(gy-e.pos.y)/420,1).normalize();orb(e.pos,tA,orbSpd()*0.8,e,true)}
    for(let y=15;y<=105;y+=16){if(Math.abs(y-gy)<20)continue;tA.set((gap-e.pos.x)/420,(y-e.pos.y)/420,1).normalize();orb(e.pos,tA,orbSpd()*0.8,e,true)}},
  zone(e){addZone({owner:e,kind:'disc',track:true,r:28,warn:1.4})},
  sweep(e){e.sw={t:0,dir:Math.random()<0.5?-1:1,acc:0}},
  missiles(e){for(let i=0;i<4;i++){const p=e.pos.clone().add(tA.set((i-1.5)*14,6,8));launchEMsl(p,new V3((i-1.5)*0.35,0.45,1),e)}msg('INCOMING MISSILES','#ff8a7a')},
  drones(e){spawnEvent({type:'swarm'});spawnEvent({type:'kamikaze'})}
};
/* 요격 포인트(약점): 보스·중간보스 몸체에 붙은 록온 가능한 부위 */
const WEAK_GEO=new THREE.BoxGeometry(1,1,1),WEAK_RING=new THREE.RingGeometry(0.9,1.25,4);
function addWeak(host,n,announce=true){
  const g=host.mesh.geometry;g.computeBoundingBox();const b=g.boundingBox,mx=Math.max(Math.abs(b.min.x),b.max.x),cy=(b.min.y+b.max.y)/2,fz=b.max.z;
  const L=[[-0.72*mx,cy,fz*0.35],[0.72*mx,cy,fz*0.35],[0,b.max.y*0.85+b.min.y*0.15,fz*0.5],[0,cy*0.7+b.min.y*0.3,fz*0.95]].slice(0,n);
  const sc=host.mesh.scale.x,each=Math.round(host.maxhp*(host.isBoss?0.09:0.13));host.weak=[];host.weakN=n;
  L.forEach((o,i)=>{const m=new THREE.Mesh(WEAK_GEO,new THREE.MeshBasicMaterial({color:0xff5030}));m.scale.setScalar(host.isBoss?5.5:4.5);scene.add(m);
    const ring=new THREE.Mesh(WEAK_RING,new THREE.MeshBasicMaterial({color:0xffe36a,side:THREE.DoubleSide,transparent:true,opacity:.9}));ring.scale.setScalar(host.isBoss?8:6.5);scene.add(ring);
    const w={type:'weak',isPart:true,host,off:new V3(...o),mesh:m,ring,t:i*0.7,pos:new V3(0,-999,0),prev:new V3(),vel:new V3(),fireT:99,alive:true,hidden:false,lvx:0,flash:0,lockN:0,
      hp:each,maxhp:each,r:host.isBoss?9:7,pts:800+stage*150,exp:20,kind:'part',ground:false};
    enemies.push(w);host.weak.push(w)});
  if(announce)msg('요격 포인트 '+n+'곳 확인 — 미사일로 파괴하라','#ffe36a',false,2.6);
}
function weakDown(w){
  const h=w.host;scene.remove(w.ring);if(!h.alive)return;h.weakN--;
  const burst=Math.round(h.maxhp*0.07);h.hp=Math.max(1,h.hp-burst);h.flash=0.15;P.pts+=150;shake=Math.max(shake,0.5);
  for(let q=0;q<24;q++){const a=rnd(0,6.28);emit(2,w.pos.x,w.pos.y,w.pos.z,Math.cos(a)*rnd(30,90),Math.sin(a)*rnd(30,90),rnd(-20,20),0.5,2.4,1,0)}
  pops.push({p:w.pos.clone(),t:0,s:'BREAK −'+burst,c:'#ffe36a'});SFX.bonus();
  if(h.weakN>0)msg('WEAK POINT DESTROYED · 남은 '+h.weakN,'#ffe36a',true,1.4);
  else{msg('ALL WEAK POINTS DOWN! 코어 노출 — 피해 ×1.4','#7affd8',true,2.6);
    if(h.timers)h.timers=h.timers.map(v=>v+2.5);if(h.mt)h.mt=h.mt.map(v=>v+2.5);if(h.ultT!=null)h.ultT+=4;h.sw=null}
}
// Indices refer to the original nine opposing machines, in command order.
const encounterLineups=[[0],[1],[2],[3,5],[4,1],[8,6,7]];
function encounterBossDefs(stageNumber=stage){
  return encounterLineups[stageNumber-1].map(index=>BOSSES[index]);
}
function spawnBoss(){
  if(bossRoster.some(host=>host.alive))return;
  bossRoster.length=0;
  const defs=encounterBossDefs(),n=defs.length;
  const weights=n===1?[1]:stage===4?[.72,.52]:stage===5?[.74,.54]:[.60,.40,.36];
  const lanes=n===1?[0]:n===2?[-68,72]:[0,-117,117];
  const hull=588*BOSS_K[(stage-1)%BOSS_K.length]*bossPower()*(1+(loop-1)*.5)*DIF().ehp;
  for(const [i,d] of defs.entries()){
    const scale=d.scale||2,core=d.coreY*scale,floor=(d.meshY||0)*scale;
    const lane=lanes[i],phase=i*1.75,weight=weights[i];
    const sway=(d.sway??(d.kind==='air'?55:60))*(n===1?1:n===2?.32:.25);
    const depth=(d.zEnd||-180)*1.3-(n===2?i*82:0);
    const formationHeight=n===3&&d.kind==='air'?18+i*5:0;
    const path=t=>{
      const approach=Math.min(1,t/(4.5+i*.24));
      const y=d.kind==='air'?d.y+formationHeight+Math.sin(t*.8+phase)*14*approach:
        floor+core+(d.walk?Math.abs(Math.sin(t*2.2+phase))*3*scale:0);
      return {
        x:lane*(1+.7*(1-approach))+Math.sin((t-4.5)*.42+phase)*sway*approach,
        y,z:-880-i*70+approach*(880+i*70+depth)+Math.sin(t*.3+phase)*25*approach
      };
    };
    const host=mkEnemy(d.geo,{hp:Math.round(hull*weight),r:d.r*scale,cY:core,
      pts:Math.round((5000+stage*2500)*weight),exp:Math.round((250+stage*30)*weight),
      kind:'boss',isBoss:true,bossDef:d,ground:false,path,
      attackRate:n===1?1:i===0?.84:n===2?.66:.52});
    const initial=path(0);
    host.pos.set(initial.x,initial.y,scrollZ+initial.z);host.prev.copy(host.pos);
    host.mesh.scale.setScalar(scale);host.mesh.position.copy(host.pos);host.mesh.position.y-=core;
    host.timers=d.pats.map((p,j)=>p[1]*.6+1+(stage===1?.45+j*1.45:0)+i*.85);
    host.ex=(stage===1?2:0)+i*.75;
    host.ultT=(stage===1?9:8)+i*2.1;
    bossRoster.push(host);
    addWeak(host,i===0?4:2,n===1);
  }
  boss=bossRoster[0];bossDef=boss.bossDef;
  const title=n===1?bossDef.name:defs.map(d=>d.name.split('"')[1]).join('  /  ');
  if(n>1)msg('편대 요격 포인트 '+bossRoster.reduce((count,host)=>count+host.weakN,0)+'곳 확인','#ffe36a',false,2.6);
  msg(title,'#ff6a5a',true,3.2);
  if(defs.some(d=>d.ymax))msg('상승해서 코어를 노려라!','#ffe36a',false,3.2);
}

function destroyBossHost(host){
  for(const w of host.weak){
    if(!w.alive)continue;
    w.alive=false;scene.remove(w.mesh,w.ring);explode(w.pos,1.6);
  }
  host.weakN=0;
  eOrb=eOrb.filter(o=>o.owner!==host);
  emsl=emsl.filter(o=>o.owner!==host);
  zones=zones.filter(z=>{
    if(z.owner!==host)return true;
    scene.remove(z.mesh);
    if(z.aim)scene.remove(z.aim.g);
    return false;
  });
  beams=beams.filter(b=>{
    if(b.owner!==host)return true;
    scene.remove(b.g);return false;
  });
  if(zoneHUD?.z.owner===host)zoneHUD=null;
  const next=bossRoster.find(e=>e.alive);
  boss=next||host;bossDef=boss.bossDef;
  if(next){
    msg(host.bossDef.name.split('"')[1]+' 격파 · 보스 '+bossRoster.filter(e=>e.alive).length+'기 남음','#ffe36a',true,1.8);
  }else{
    bossState='dead';bossT=0;slowT=.7;
  }
}

function kill(e,byPlayer=true){
  if(!e.alive)return;e.alive=false;scene.remove(e.mesh);if(e.isPart){explode(e.pos,2.4);if(byPlayer){score+=Math.round(e.pts*DIF().sc);gainExp(e.exp);pops.push({p:e.pos.clone(),t:0,s:'+'+e.pts,c:'#ffe36a'})}weakDown(e);return}if(e.parts)for(const p of e.parts){scene.remove(p.mesh);explode(p.pos,2)}
  explode(e.pos,e.isMid?5:e.isBoss?7:e.type==='bomber'||e.type==='destroyer'?3.5:e.ground?2.2:e.type==='drone'?1.1:1.6);
  if(e.isBoss)destroyBossHost(e);
  if(!byPlayer)return;
  if(e.fl&&!e.isBoss){e.pts=Math.round(e.pts*1.5);pops.push({p:e.pos.clone().add(tA.set(0,6,0)),t:0,s:'CHASE ×1.5',c:'#ffb040'})}
  if(e.runner){P.pts+=300;msg('RUNNER DOWN! +300PT','#ffe36a',true,1.8);dropItem(e.pos,true)}
  combo++;comboT=1.8;const mult=Math.min(3,1+0.1*(combo-1));const pts=Math.round(e.pts*mult*DIF().sc);
  score+=pts;gainExp(e.exp);pops.push({p:e.pos.clone(),t:0,s:'+'+pts,c:combo>=5?'#ffe36a':'#ffffff'});
  if(combo>=2&&combo%5===0)SFX.chain(combo/5);
  if(e.group&&e.group.n>=4&&!e.group.fled&&e.group.k+1>=Math.ceil(e.group.n/2)&&e.group.k+1<e.group.n){e.group.fled=1;for(const o of enemies)if(o.group===e.group&&o.alive&&o!==e&&!o.fl)o.fleeAt=o.t+rnd(0.15,0.6);msg('편대 이탈 — 도주한다!','#ffb040')}
  if(e.group){e.group.k++;if(e.group.k===e.group.n){score+=500;msg('FORMATION WIPED +500','#ffe36a');if(wantDrop(0.4))dropItem(e.pos)}}
  if((e.drop&&wantDrop(0.75))||(e.ground&&wantDrop(0.05))||(e.type==='heli'&&wantDrop(0.12)))dropItem(e.pos);stageKills++;
  if(e.isMid){msg('LARGE TARGET DESTROYED','#ffe36a',true,2);dropItem(e.pos,true);shake=0.6}
}
let lastDrop=-99,stageDrops=0,stageKills=0;
function wantDrop(p){return time-lastDrop>6&&items.length<2&&stageDrops<8&&Math.random()<p}
function dropItem(p,force){
  if(!force&&(time-lastDrop<6||items.length>=2||stageDrops>=8))return;
  const w=[];if(P.gunLv<GUN_MAX)w.push(['P',3]);if(P.mslLv<MSL_MAX)w.push(['M',2.2]);if(P.spdLv<SPD_MAX)w.push(['S',1.2]);if(P.agiLv<AGI_MAX)w.push(['R',1.2]);
  if(P.hp<P.maxhp*0.85)w.push(['H',P.hp<P.maxhp*0.4?3:1.4]);w.push(['STAR',0.8]);
  let r=Math.random()*w.reduce((a,b)=>a+b[1],0),k='STAR';for(const[t,v]of w){if(r<v){k=t;break}r-=v}
  lastDrop=time;stageDrops++;const s=new THREE.Sprite(ITEM_MAT[k]);s.scale.set(8,8,1);s.position.copy(p);scene.add(s);items.push({k,mesh:s,pos:p.clone(),t:0})}
function gainExp(n){
  P.exp+=n;
  while(P.exp>=P.next){P.exp-=P.next;P.lv++;P.next=Math.round(150+P.lv*85);
    if(P.lv===4)applyHullUpgrade();if(P.lv===7)P.mslCap=Math.min(28,P.mslCap+4);
    const pk=PERKS.find(p=>p[0]===P.lv);msg('PILOT LEVEL UP! LV '+P.lv,'#7affd8',true,2.4);if(pk)msg('특전: '+pk[1],'#ffe36a',false,2.6);SFX.lvl()}
}

function updEnemies(dt){
  const pz=scrollZ;
  for(const e of enemies){
    if(!e.alive)continue;
    if(e.isPart){const h=e.host;if(!h.alive){e.alive=false;scene.remove(e.mesh);scene.remove(e.ring);explode(e.pos,1.6);continue}
      e.t+=dt;e.prev.copy(e.pos);h.mesh.updateMatrixWorld();e.pos.copy(e.off).applyMatrix4(h.mesh.matrixWorld);e.hidden=!!h.hidden;e.mesh.visible=e.ring.visible=!e.hidden;
      e.mesh.position.copy(e.pos);e.mesh.rotation.set(e.t*1.3,e.t*1.9,0);const pl=0.5+0.5*Math.sin(e.t*8);
      e.mesh.material.color.setRGB(1,0.25+pl*0.5,0.15+(e.flash>0?0.8:0));if(e.flash>0)e.flash-=dt;
      e.ring.position.copy(e.pos);e.ring.lookAt(camera.position);e.ring.rotation.z+=e.t;e.ring.scale.setScalar((h.isBoss?8:6.5)*(1+pl*0.25));e.ring.material.opacity=0.45+pl*0.5;continue}
    e.t+=dt;e.prev.copy(e.pos);if(e.flash>0){e.flash-=dt;e.mesh.material=e.flash>0?WHITEMAT:e.mesh.userData.skin||VOXMAT}
    if(e.rotor)e.rotor.rotation.y+=dt*25;
    let hold=false;
    if(e.ground){
      const rz=e.pos.z-pz;if(rz>90){e.alive=false;scene.remove(e.mesh);continue}
      if(e.sway){e.pos.x=e.base.x+Math.sin(time*0.35+e.base.z)*e.sway;e.mesh.position.copy(e.pos)}
      if(e.pop){if(rz>-430&&e.popY<0){if(e.popY<=-7.9){for(let q=0;q<10;q++)emit(1,e.pos.x+rnd(-5,5),1,e.pos.z+rnd(-5,5),rnd(-8,8),rnd(6,16),0,0.9,2,5,0.8,[.6,.55,.5]);if(!e.popMsg){e.popMsg=1;msg('POP-UP GUN!','#ff9a7a',false,1)}}e.popY=Math.min(0,e.popY+dt*16)}
        e.hidden=e.popY<-4;e.mesh.visible=!e.hidden;e.mesh.position.y=e.base.y+e.popY}
      if(e.type==='walker'){e.pos.x=e.base.x+Math.sin(time*0.6+e.base.z)*18;e.mesh.position.set(e.pos.x,Math.abs(Math.sin(time*4+e.base.z))*0.8,e.pos.z)}
      if(e.type==='destroyer'||e.type==='boat'){e.mesh.rotation.y=Math.cos(time*0.35+e.base.z)*(e.sway?0.25:0);for(let i=0;i<2;i++)emit(1,e.pos.x+rnd(-4,4),0.6,e.pos.z-rnd(0,14),0,0,0,0.6,1.5,3,0.5,[1,1,1])}
      else e.mesh.rotation.y=Math.atan2(P.x-e.pos.x,pz-e.pos.z);
      e.vel.set(0,0,0);
    }else{
      let r=e.path(e.t);
      if(e.fleeAt!=null&&e.t>=e.fleeAt&&!r.hide){
        if(!e.fl){const sx=Math.sign(e.pos.x-P.x)||1;e.fl={x:e.pos.x,y:e.pos.y,z:e.pos.z-pz,t:e.t,dx:sx*rnd(0.5,1.1),dy:rnd(0.35,0.9),dz:-rnd(0.5,1.1)}}
        const u=e.t-e.fl.t,a=u*u*75+u*35;r={x:e.fl.x+e.fl.dx*a,y:e.fl.y+e.fl.dy*a,z:e.fl.z+e.fl.dz*a,dead:u>2.8,hold:true};
        if(Math.random()<0.7)emit(0,e.pos.x,e.pos.y,e.pos.z+2,0,0,-speed*0.8,0.22,2,0.5,1)}
      if(r.dead){if(e.runner)msg('TARGET ESCAPED','#ff8a6a',true,1.6);e.alive=false;scene.remove(e.mesh);continue}
      e.hidden=!!r.hide;e.mesh.visible=!e.hidden;hold=!!r.hold;
      if(e.hidden){e.pos.set(r.x,r.y,pz+r.z);e.prev.copy(e.pos);continue}
      e.lvx=e.t>dt*1.5?(r.x-e.prev.x)/dt:0;
      e.pos.set(r.x,r.y,pz+r.z);e.vel.subVectors(e.pos,e.prev).divideScalar(Math.max(dt,1e-4));e.mesh.position.copy(e.pos);
      if(e.isBoss){const d=e.bossDef;e.mesh.position.set(e.pos.x,e.pos.y-(e.cY||0),e.pos.z);
        if(d.robot){e.mesh.rotation.set(0.04,Math.sin(e.t*0.5)*0.18,Math.sin(e.t*0.7)*0.04);if(d.splash)for(let i=0;i<3;i++)emit(1,e.pos.x+rnd(-22,22),1,e.pos.z+rnd(-10,10),rnd(-5,5),rnd(8,20),0,0.8,3,7,0.6,[1,1,1]);
          if(d.kind==='air')for(let i=0;i<2;i++)emit(0,e.pos.x+(i?1:-1)*4*(e.cY/25.5),e.pos.y-e.cY*0.25,e.pos.z-6,0,-30,0,0.25,3,1,0)}
        else if(d.kind==='air')e.mesh.rotation.set(0.28,0,Math.sin(e.t*0.42)*0.08);else e.mesh.rotation.set(0,0,0)}
      else if(e.isMid){e.mesh.rotation.set(0.12,Math.sin(e.t*0.4)*0.15,Math.sin(e.t*0.6)*0.1)}
      else if(false){if(e.parts){e.trail.push(new V3(e.pos.x,e.pos.y,e.pos.z-pz));if(e.trail.length>200)e.trail.shift();
          e.parts.forEach((p,i)=>{const idx=Math.max(0,e.trail.length-1-(i+1)*5);p.pos.copy(e.trail[idx]);p.pos.z+=pz;p.mesh.position.copy(p.pos);tA.copy(i?e.parts[i-1].pos:e.pos);p.mesh.lookAt(tA);p.mesh.visible=true});
          tA.copy(e.pos).add(e.vel);e.mesh.lookAt(tA)}
        }
      else if(e.type==='heli'){e.mesh.rotation.set(0.15,Math.atan2(P.x-e.pos.x,pz-e.pos.z),clamp(-e.lvx*0.01,-0.4,0.4))}
      else{tA.copy(e.pos).add(e.vel.lengthSq()>1?e.vel:tB.set(0,0,1));e.mesh.lookAt(tA);e.mesh.rotateZ(clamp(-e.lvx*0.012,-0.9,0.9));if(e.type==='drone')e.mesh.rotateZ(e.t*6)}
      if(!e.flyby&&e.pos.distanceTo(camera.position)<45){e.flyby=true;SFX.whoosh()}
    }
    if(state!=='play'||!P.alive||bossState==='dead')continue;
    const rz=e.pos.z-pz;e.fireT-=dt;
    if(e.burstShots>0){
      e.burstDelay-=dt;
      while(e.burstShots>0&&e.burstDelay<=0){
        e.burstShots--;e.burstDelay+=.14;fan(e.pos,3,.06,orbSpd()*1.15,e);
      }
    }
    if(e.kind==='v'){if(!e.shot&&rz>-400&&rz<-170){e.shot=true;if(Math.random()<(0.35+stageSourceNumber()*0.05)*DIF().fire)orb(e.pos,aimDir(e.pos),orbSpd())}}
    else if(e.kind==='s'||e.kind==='d'){if(e.fireT<=0&&rz<-60){e.fireT=rnd(1.8,3.2)/fireK();if(Math.random()<0.55)orb(e.pos,aimDir(e.pos),orbSpd())}}
    else if(e.kind==='o'){if(hold&&e.fireT<=0){e.fireT=rnd(1.2,2)/fireK();orb(e.pos,aimDir(e.pos),orbSpd())}}
    else if(e.kind==='w'){if(e.fireT<=0&&rz>-420&&rz<-160){e.fireT=99;if(Math.random()<(0.2+stageSourceNumber()*0.03)*DIF().fire)orb(e.pos,aimDir(e.pos),orbSpd()*0.9)}}
    else if(e.kind==='h2'){if(hold&&e.fireT<=0){e.fireT=rnd(1.6,2.4)/fireK();for(let k=0;k<3;k++)setTimeout(()=>{if(e.alive&&state==='play')orb(e.pos,aimDir(e.pos,rnd(-.04,.04)),orbSpd()*1.1)},k*120)}}
    else if(e.kind==='hb'){if(hold&&e.fireT<=0){e.fireT=1.6/Math.sqrt(fireK());fan(e.pos,stage>=3?5:3,0.15,orbSpd()*0.9)}}
    else if(e.kind==='g'){
      if(e.hidden){}
      else if(e.type==='mlrs'){if(rz>-650&&rz<-200&&e.fireT<=0){e.fireT=rnd(5,7)/Math.sqrt(fireK());for(let q=0;q<3;q++)launchEMsl(tB.copy(e.pos).add(tC.set((q-1)*2,7,2)),new V3((q-1)*0.4,1,0.3));msg('ROCKET SALVO!','#ff8a7a',false,1.2)}}
      else if(e.type==='walker'){if(rz>-460&&rz<-80&&e.fireT<=0){e.fireT=rnd(2,3)/fireK();for(let q=0;q<3;q++)setTimeout(()=>{if(e.alive&&state==='play'){const fp=e.pos.clone();fp.y+=10;orb(fp,aimDir(fp),orbSpd()*1.05)}},q*110)}}
      else if(e.type==='sam'){if(rz>-650&&rz<-150&&e.fireT<=0){e.fireT=rnd(4.5,6.5)/Math.sqrt(fireK());launchEMsl(tB.copy(e.pos).add(tC.set(0,6,0)),new V3(0,1,0.4));msg('SAM LAUNCH!','#ff8a7a',false,1.2)}}
      else if(rz>-460&&rz<-60&&e.fireT<=0){e.fireT=rnd(1.4,2.4)/fireK();if(e.type==='destroyer')fan(e.pos,3,0.12,orbSpd());else orb(e.pos,aimDir(e.pos),orbSpd())}}
    else if(e.kind==='hop'){if(!e.shot&&e.pos.y>40){e.shot=true;orb(e.pos,aimDir(e.pos),orbSpd())}}
    else if(e.isMid&&e.t>4&&e.t<18){const M=e.mdef;M.pats.forEach((p,i)=>{e.mt[i]-=dt;if(e.mt[i]<=0){e.mt[i]=p[1];PAT[p[0]](e)}});
      if(e.sw){e.sw.t+=dt;e.sw.acc+=dt;while(e.sw.acc>0.05){e.sw.acc-=0.05;const a=lerp(-0.7,0.7,e.sw.t/1.4)*e.sw.dir;tC.copy(aimDir(e.pos));tC.applyAxisAngle(UPV,a);orb(e.pos,tC,orbSpd()*1.1,e)}if(e.sw.t>1.4)e.sw=null}
      if(e.t>17.6&&!e.esc){e.esc=1;msg(M.name+' ESCAPED','#ff9a7a')}}
    else if(e.isBoss&&e.t>4.5){
      const d=e.bossDef,rage=e.hp<e.maxhp*0.5;
      d.pats.forEach((p,i)=>{e.timers[i]-=dt*e.attackRate*(rage?1.35:1);if(e.timers[i]<=0){e.timers[i]=p[1];PAT[p[0]](e)}});
      if(e.sw){e.sw.t+=dt;e.sw.acc+=dt;while(e.sw.acc>0.045){e.sw.acc-=0.045;const a=lerp(-0.75,0.75,e.sw.t/1.4)*e.sw.dir;tC.copy(aimDir(e.pos));tC.applyAxisAngle(UPV,a);orb(e.pos,tC,orbSpd()*1.25,e,true)}if(e.sw.t>1.4)e.sw=null}
      e.ultT-=dt*e.attackRate;if(e.ultT<=0&&d.ult&&!zones.some(z=>z.owner?.isBoss&&z.owner!==e)){e.ultT=rage?8:11.5;msg('!! '+d.ultName+' !!','#ff4a3a',true,2.2);SFX.warn();ULT[d.ult](e);for(let q=0;q<30;q++){const a=rnd(0,6.28);emit(2,e.pos.x+Math.cos(a)*30,e.pos.y+Math.sin(a)*30,e.pos.z,-Math.cos(a)*60,-Math.sin(a)*60,0,0.5,2,1,0)}}
      if(rage){if(!e.raged){e.raged=true;msg('BOSS ENRAGED!','#ff6a5a',true,1.8)}e.ex-=dt*e.attackRate;if(e.ex<=0){e.ex=d.extra[1];PAT[d.extra[0]](e)}}
    }
    if(!e.ground&&P.inv<=0&&e.pos.distanceTo(ppos)<e.r*0.6+3){damage();if(e.kind==='k'){kill(e,false)}else{e.hp-=4;if(e.hp<=0)kill(e)}}
    if(e.parts&&P.inv<=0)for(const p of e.parts)if(p.pos.distanceTo(ppos)<9)damage();
  }
  enemies=enemies.filter(e=>e.alive);
}
function hurtEnemy(e,d){if(!e.alive)return;if(e.weak)d*=e.weakN>0?0.6:1.4;e.hp-=d;e.flash=0.06;SFX.hit();if(e.hp<=0)kill(e);else score+=10}

/* =====================================================================
   플레이어
   ===================================================================== */
const keys={},tch={gun:0,msl:0},stick={on:false,id:-1,ox:0,oy:0,x:0,y:0};
function damage(amt=20){
  if(P.inv>0||!P.alive||state!=='play')return;
  if(P.rollT>0){if(time-(P.dodgeMsg||0)>0.6){P.dodgeMsg=time;msg('DODGE!','#d8b0ff')}return}
  P.hp=Math.max(0,P.hp-amt);P.inv=1.6;hitFlash=1;shake=0.6;SFX.hurt();combo=0;
  if(P.gunLv>1&&Math.random()<0.5){P.gunLv--;msg('GUN POWER DOWN','#ff8a7a')}
  if(P.hp<=0){P.hp=0;startCrash()}
}
const GUN=[null,
  {name:'VULCAN',x:[-1.8,1.8],a:[0,0],r:1},
  {name:'VULCAN II',x:[-2.6,0,2.6],a:[0,0,0],r:0.85},
  {name:'WIDE',x:[-2.6,0,2.6,-3,3],a:[0,0,0,-.09,.09],r:0.85},
  {name:'RADIAL',x:[-2.6,0,2.6,-3,3,-3.5,3.5,-3.5,3.5],a:[0,0,0,-.1,.1,-.22,.22,-.4,.4],r:0.8},
  {name:'RADIAL II',x:[-2.6,0,2.6,-3,3,-3.5,3.5,-3.5,3.5,-2,2,0,0],a:[0,0,0,-.09,.09,-.2,.2,-.36,.36,-.58,.58,0,0],v:[0,0,0,0,0,0,0,0,0,0,0,.16,-.12],r:0.66},
  {name:'THUNDER',thunder:true,r:0.75}];
const GUN_MAX=GUN.length-1,AGI_MAX=3,SPD_MAX=3,MSL_MAX=5;
/* 플레이어 화력 지수: 스테이지 1 초기 기체 = 1. 보스·중간보스 체력이 이 값에 맞춰 늘어난다 */
const GUN_F=[0,1,1.6,2.2,2.8,3.4,3.2],MSL_F=[0,1,1.25,1.5,2.0,2.4,3.0];
// Regular boss base hull, before loadout, difficulty and loop multipliers.
const BOSS_K=[0.8,0.94,1.03,1.24,1.48,2.53];
function bossPower(){
  // A lock spends one charge even when it launches two or three missiles.
  const volleyBonus=.28*(salvo()-1);
  const reloadBonus=hasPerk(5)?.15:0;
  const warheadBonus=hasPerk(9)?.12:0;
  return powerK()*(1+volleyBonus+reloadBonus+warheadBonus);
}
function powerK(){const raw=(0.6*GUN_F[P.gunLv]+0.4*MSL_F[P.mslLv]*Math.min(1.6,P.mslCap/8*0.6+0.4))*gunMult();return Math.pow(Math.max(1,raw),0.9)}
const salvo=()=>[1,1,1,2,2,3][P.mslLv]||1;
let bolts=[];
function fireThunder(){
  const start=ppos.clone();start.z-=6;const pts=[start],hit=[];
  let cur=bestTarget(30*D2R,680);
  if(cur){hit.push(cur);pts.push(cur.pos.clone());
    for(let k=0;k<3;k++){let nb=null,bd=150;for(const e of enemies){if(!e.alive||e.hidden||hit.includes(e))continue;const d=e.pos.distanceTo(cur.pos);if(d<bd){bd=d;nb=e}}if(!nb)break;hit.push(nb);pts.push(nb.pos.clone());cur=nb}
    hit.forEach((e,i)=>{for(let q=0;q<6;q++)emit(2,e.pos.x,e.pos.y,e.pos.z,rnd(-60,60),rnd(-60,60),rnd(-60,60)-speed,0.25,1.4,1,2,[.6,.9,1]);hurtEnemy(e,gunMult()*(i===0?2.2:1.5)*(e.isBoss?3.1:1))});
  }else pts.push(ppos.clone().addScaledVector(pfwd,460));
  for(const m of emsl)if(m.hp>0&&m.pos.distanceTo(ppos)<300&&pfwd.angleTo(tA.subVectors(m.pos,ppos))<0.5){m.hp=0;explode(m.pos,0.8);break}
  bolts.push({pts,t:0});SFX.zap();
}
function tryRoll(dir){if(P.agiLv<1||P.rollCd>0||P.rollT>0||state!=='play')return;P.rollT=0.5;P.rollDir=dir;P.rollCd=Math.max(0.6,1.6-P.agiLv*0.3);P.vx+=dir*90;SFX.whoosh()}
const lockCap=()=>Math.min(18,8+(P.mslLv-1)*2+(P.lv>=7?2:0));
let lockFA=null,lockFull=false;
const lockMax=e=>e.isPart?3:e.isBoss?6:e.isMid?4:(e.type==='bomber'||e.type==='destroyer')?4:e.type==='heli'?2:1;
function bestTarget(cone,maxD,lockMode){
  let best=null,ba=cone;
  for(const e of enemies){if(!e.alive||e.hidden)continue;if(lockMode&&e.lockN>=lockMax(e))continue;
    tA.subVectors(e.pos,ppos);const d=tA.length();if(d>maxD||tA.z>-8)continue;let a=pfwd.angleTo(tA);if(lockMode)a+=e.lockN*0.3;if(a<ba){ba=a;best=e}}
  return best;
}
const rush={cool:0,focus:0};
function triggerRush(){
  if(state!=='play'||paused||rush.cool>0)return;
  rush.cool=12;rush.focus=2.5;slowT=Math.max(slowT,2.5);
  speedMul=Math.max(1.9,speedMul);burnT=Math.max(burnT,2.5);
  fovKick=11;SFX.burner();msg('RUSH  /  FOCUS','#99f4ff',true,1);
}
document.getElementById('bRush').addEventListener('pointerdown',triggerRush);
let crash=null;
function startCrash(){if(state==='crash')return;state='crash';crash={t:0,vx:P.vx*0.4,vy:8,spin:(Math.random()<0.5?-1:1)*rnd(4,6),rz:0,rx:0};
  locks=[];lockHeld=false;launchQ=[];msg('ENERGY DEPLETED!','#ff6a5a',true,2.4);msg('MAYDAY! MAYDAY!','#ffb0a0',false,2.4);playSong('over');SFX.hurt();
  if(AU.ctx&&AU.on){const a=AU.ctx.currentTime;pulse(a,600,1.8,0.08,.5,AU.sfx,90)}}
function updCrash(dt){
  const c=crash;c.t+=dt;c.vy-=75*dt;P.y+=c.vy*dt;P.x=clamp(P.x+c.vx*dt,-XB-20,XB+20);c.rz+=c.spin*dt;c.rx=Math.min(0.9,c.rx+dt*0.5);
  ppos.set(P.x,P.y,scrollZ);pMesh.position.copy(ppos);pMesh.rotation.set(-c.rx,0,c.rz);pMesh.visible=view===3;
  for(let i=0;i<2;i++)emit(1,P.x+rnd(-1,1),P.y+rnd(0,1.5),scrollZ+rnd(-1,1.5),rnd(-3,3),rnd(6,12),-speed*0.82,rnd(0.8,1.1),1.2,3.2,0.45,[.2,.18,.2]);
  emit(0,P.x+rnd(-1,1),P.y,scrollZ+0.5,rnd(-4,4),rnd(0,6),-speed*0.85,0.3,1.8,0.8,1);
  if(Math.random()<dt*3){explode(tA.copy(ppos).add(tB.set(rnd(-3,3),rnd(-1,1),rnd(0,4))),0.6)}
  const gy=['sky','strato'].includes(curTheme.kind)?-12:0.5;
  if(P.y<=gy){P.y=gy;ppos.y=gy;explode(ppos,5);for(let i=0;i<40;i++){const a=rnd(0,6.28),sp=rnd(20,70);emit(3,P.x,gy+1,scrollZ,Math.cos(a)*sp,rnd(30,80),Math.sin(a)*sp-speed*0.3,rnd(1,1.8),1.2,1.2,0.4,[.3,.28,.3])}
    for(let i=0;i<30;i++)emit(1,P.x+rnd(-8,8),gy+rnd(0,6),scrollZ+rnd(-8,8),rnd(-6,6),rnd(8,20),-speed*0.2,rnd(2,3.5),4,14,0.3,[.3,.27,.27]);
    shake=1;hitFlash=1;P.alive=false;pMesh.visible=false;state='over';overT=0;msg('SHOT DOWN','#ff6a5a',true,3)}
}
function updPlayer(dt){
  if(!P.alive)return;
  if(state==='crash'){updCrash(dt);return}
  let ix=0,iy=0,gun=false,mh=false;
  if(state==='play'||state==='clear'){
    ix=((keys.ArrowRight||keys.KeyD)?1:0)-((keys.ArrowLeft||keys.KeyA)?1:0)+stick.x;
    // 기본: 비행기식 (위로 밀면 하강·아래로 당기면 상승). 메뉴에서 직관식으로 전환 가능
    const up=((keys.ArrowUp||keys.KeyW)?1:0)-((keys.ArrowDown||keys.KeyS)?1:0)-stick.y;
    iy=CFG.invert?-up:up;
    gun=mouse.gun||mouse.gunTap||tch.gun;mh=mouse.missile||tch.msl;mouse.gunTap=false;
  }else{ix=Math.sin(time*0.5)*0.5;iy=Math.sin(time*0.7)*0.4}
  ix=clamp(ix,-1,1);iy=clamp(iy,-1,1);
  const spM=1+0.18*P.spdLv,agR=7+3.5*P.agiLv;
  P.vx+=(ix*125*spM-P.vx)*Math.min(1,dt*agR);P.vy+=(iy*82*spM-P.vy)*Math.min(1,dt*agR);
  if(P.rollCd>0)P.rollCd-=dt;if(P.rollT>0)P.rollT-=dt;
  P.x=clamp(P.x+P.vx*dt,-XB,XB);ymaxCur=lerp(ymaxCur,(bossState==='fight')?Math.max(YMAX,...bossRoster.map(e=>e.alive?(e.bossDef.ymax||YMAX):YMAX)):YMAX,Math.min(1,dt*0.8));if(state==='clear'&&clearT>0.9){P.vy=lerp(P.vy,95,Math.min(1,dt*2.2));P.vx*=0.9}P.y=clamp(P.y+P.vy*dt,YMIN,state==='clear'?9999:ymaxCur);if(Math.abs(P.x)>=XB&&P.vx*P.x>0)P.vx*=0.5;
  ppos.set(P.x,P.y,scrollZ);pfwd.set(P.vx*0.0012,P.vy*0.0035,-1).normalize();
  pMesh.position.copy(ppos);const bk=1+0.25*P.agiLv,rl=P.rollT>0?-P.rollDir*(1-P.rollT/0.5)*Math.PI*2:0;pMesh.rotation.set(P.vy*0.006,-P.vx*0.002,-P.vx*0.011*bk/spM+rl);
  if(P.rollT>0){const ang=(1-P.rollT/0.5)*Math.PI*2*P.rollDir;for(const sd of[-1,1])emit(1,P.x+Math.cos(ang)*6*sd,P.y+Math.sin(ang)*6*sd,scrollZ-2,0,0,-speed*0.15,0.3,0.45,1,0.5,[.9,.82,1])}
  pMesh.visible=view===3&&(entryShield||!(P.inv>0&&Math.floor(time*16)%2===0));
  shadow.position.set(P.x,0.4,scrollZ);shadow.scale.setScalar(1-P.y/180);shadow.visible=false;
  for(const f of pFlames){const L=2.6+(speedMul-1)*7.5+Math.random()*.65;f.scale.set(1,1,L);f.position.z=f.userData.z+L/2;f.material.uniforms.phase.value=time}
  if(P.inv>0)P.inv-=dt;if(P.inv<=0)entryShield=false;
  if(state!=='play')return;
  // 기믹: 다리 밑 통과 / 다리 충돌, 마천루 충돌
  for(const b of bridges){if(!b.passed&&scrollZ<b.z){b.passed=true;const u=b.under||31,hh=b.hitHi||42,ovr=b.over||66;if(P.y<u){score+=1000;msg('UNDER THE '+b.name+'! +1000','#7affd8',true,1.6);SFX.bonus()}else if(P.y<hh&&Math.abs(P.x)<205){damage();msg(b.name+' COLLISION!','#ff6a5a')}else if(P.y>ovr){score+=200;msg('OVER THE '+b.name+' +200','#b6ffc4')}}}
  for(const b of rings){if(!b.passed&&scrollZ<b.pos.z){b.passed=true;if(Math.hypot(P.x-b.pos.x,P.y-b.pos.y)<17){score+=300;speedMul=Math.max(speedMul,1.55);burnT=Math.max(burnT,2.2);fovKick=12;msg('BOOST RING! +300','#ffe36a',true,1.2);SFX.bonus();SFX.burner()}}}
  for(const b of tallB){if(P.y<b.h&&Math.abs(scrollZ-b.z)<b.hw+3&&Math.abs(P.x-b.x)<b.hw+3){if(P.inv<=0){damage(25);msg(curTheme.kind==='canyon'?'ROCK CRASH!':'BUILDING CRASH!','#ff6a5a')}P.x=b.x+Math.sign(P.x-b.x||1)*(b.hw+4);P.vx*=-0.4}}
  if(hasPerk(8)){P.repairT+=dt;if(P.repairT>20){P.repairT=0;if(P.hp<P.maxhp){P.hp=Math.min(P.maxhp,P.hp+15);msg('AUTO REPAIR','#9affb0')}}}
  // 지형(빌딩·숲·절벽·산·섬…) 스침: 에너지 지속 감소
  while(obIdx<obst.length&&obst[obIdx].z>scrollZ+80)obIdx++;
  let scraping=false;for(let i=obIdx;i<obst.length&&obst[i].z>scrollZ-80;i++){const o=obst[i];if(Math.abs(o.z-scrollZ)<o.r&&Math.abs(o.x-P.x)<o.r+2&&P.y<o.y1&&P.y>o.y0-2){scraping=true;break}}
  if(scraping&&P.rollT<=0){P.hp-=34*dt*DIF().bspd;P.vy+=140*dt;shake=Math.max(shake,0.18);hitFlash=Math.max(hitFlash,0.25);
    for(let q=0;q<3;q++)emit(2,P.x+rnd(-4,4),P.y-1,scrollZ+rnd(-2,4),rnd(-50,50),rnd(10,60),rnd(-20,20)-speed,0.25,1,1,2);
    P.scrT-=dt;if(P.scrT<=0){P.scrT=0.7;msg('SCRAPE! ENERGY ▼','#ff9a7a',false,0.8);SFX.hit()}
    if(P.hp<=0){P.hp=0;P.inv=0;damage(0)}}
  // 기총
  P.fireT-=dt;
  if(gun&&P.fireT<=0){
    const G=GUN[P.gunLv];P.fireT=0.09*G.r/(1+0.03*(P.lv-1));
    const port=firingPort++%2;const gunOrigin=lightMuzzle(port);if(G.thunder){fireThunder();P.fireT=0.11/(1+0.03*(P.lv-1))}else{
    const t=bestTarget(9*D2R,600);const base=pfwd.clone();if(t){tA.subVectors(t.pos,ppos).normalize();base.lerp(tA,0.85).normalize()}
    for(let i=0;i<G.x.length;i++){const d=base.clone();if(G.a[i])d.applyAxisAngle(UPV,G.a[i]);if(G.v&&G.v[i]){d.y+=G.v[i];d.normalize()}const p=i===0?gunOrigin.clone():lightMuzzle((port+i)%2);p.x+=G.x[i]*.45;
      pBul.push({pos:p,prev:p.clone(),vel:d.multiplyScalar(580).add(tB.set(0,0,-speed)),l:1,pierce:hasPerk(6)?1:0,hitSet:null})}
    SFX.shot();}emit(2,P.x,P.y,scrollZ-7,0,0,-speed,0.05,2.2,1,0);
  }
  // 다중 록온 → 일제 발사
  locks=locks.filter(e=>e.alive&&!e.hidden);for(const e of enemies)e.lockN=0;for(const e of locks)e.lockN++;
  if(mh){lockHeld=true;lockT-=dt;
    const cap=Math.min(P.msl,lockCap());if(lockT<=0&&locks.length<cap){const t=bestTarget((rush.focus>0?46:34)*D2R,1000,true);if(t){locks.push(t);t.lockN++;if(t.lockN===1)SFX.lock();lockT=rush.focus>0?.009:hasPerk(3)?.03:.05;
      if(locks.length===cap&&!lockFull){lockFull=true;if(AU.ctx&&AU.on&&!audioExited&&!audioAway){const a=Math.max(AU.ctx.currentTime,targetToneTail),out=targetToneOutput();pulse(a,1568,0.06,0.05,.25,out);pulse(a+.07,2093,.1,.05,.25,out);targetToneTail=a+.173}}}}}
  else if(lockHeld){lockHeld=false;
    const tg=locks.length?locks.slice(0,P.msl):(P.msl>=2?[null,null]:[]);
    lockFull=false;if(tg.length)lockFA={n:tg.length,sv:salvo(),t:0,tg:tg.slice()};
    const sv=salvo();let qi=0;tg.forEach(t=>{for(let k=0;k<sv;k++){launchQ.push({at:qi*0.022,t,i:qi,n:tg.length*sv});qi++}});P.msl-=tg.length;
    if(tg.length>=4||sv>1)msg('MULTI-LOCK ×'+tg.length+(sv>1?'  SALVO ×'+sv:''),'#ff9a7a',true,1.6);if(tg.length){speedMul=Math.max(speedMul,1.3);burnT=Math.max(burnT,1.2);fovKick=Math.max(fovKick,9);shake=Math.max(shake,0.15)}
    if(tg.length)SFX.launch(tg.length*sv);locks=[]}
  for(const q of launchQ)q.at-=dt;
  for(const q of launchQ.filter(q=>q.at<=0)){
    // 과장된 궤적: 크게 바깥으로 튀어나가 하늘에 곡선을 그린 뒤 꺾여 들어간다
    const side=q.i%2?1:-1,style=Math.floor(q.i/2)%3;
    const p=pMesh.localToWorld(new V3(side*4.2,-.48,.9));
    const lift=[1,-.53,.33][style]*(P.y<30&&style===1?-1:1);
    const v=new V3(side*(104+style*24),lift*(88+style*14),-110-style*19);v.z-=speed;
    if(P.y<30&&v.y<0)v.y=-v.y*0.5;
    missiles.push({pos:p,prev:p.clone(),vel:v,t:0,tg:q.t,seed:rnd(0,6.28),w:rnd(6,10),amp:rnd(150,230),side,lift,arcPhase:style*1.7,delay:.37+style*.105,freeBurst:1.18+style*.16,l:6})}
  launchQ=launchQ.filter(q=>q.at>0);
  if(P.msl<P.mslCap){P.regen+=dt;if(P.regen>(hasPerk(5)?0.2:0.32)/(1+0.15*(P.mslLv-1))){P.regen=0;P.msl++}}else P.regen=0;
}

/* =====================================================================
   탄 · 미사일 · 아이템
   ===================================================================== */
const u1=new V3(),u2=new V3();
function updShots(dt){
  for(const b of pBul){
    b.l-=dt;b.prev.copy(b.pos);b.pos.addScaledVector(b.vel,dt);
    const hitBody=(e,p)=>{for(let k=0;k<4;k++)emit(2,b.pos.x,b.pos.y,b.pos.z,rnd(-40,40),rnd(-40,40),rnd(-40,40)-speed,0.15,1,1,2);hurtEnemy(e,gunMult()*p);if(b.pierce>0&&!e.isBoss){b.pierce--;b.hitSet=e}else b.l=0};
    for(const e of enemies){if(!e.alive||e.hidden||e===b.hitSet)continue;
      if(segDist(b.prev,b.pos,e.pos)<e.r){hitBody(e,1);if(b.l<=0)break}
      else if(e.parts){for(const p of e.parts)if(segDist(b.prev,b.pos,p.pos)<8){hitBody(e,0.5);break}if(b.l<=0)break}}
    if(b.l>0)for(const m of emsl){if(m.hp>0&&segDist(b.prev,b.pos,m.pos)<3.4){m.hp=0;b.l=0;score+=50;explode(m.pos,0.8);break}}
    if(b.pos.y<0)b.l=0;
  }
  pBul=pBul.filter(b=>b.l>0);
  for(const o of eOrb){o.l+=dt;o.prev.copy(o.pos);o.pos.addScaledVector(o.vel,dt);if(P.alive&&segDist(o.prev,o.pos,ppos)<3.3){o.l=99;damage(o.dmg)}}
  eOrb=eOrb.filter(o=>o.l<9&&o.pos.y>-5&&o.pos.z-scrollZ<80&&o.pos.z-scrollZ>-1000);
  // 이타노 서커스 미사일
  const dark=['ruins','strato'].includes(curTheme.kind)?[.78,.8,.92]:[1,1,1];
  for(const m of missiles){
    m.t+=dt;m.l-=dt;
    if(!(m.tg&&m.tg.alive)){m.tg=null;if(m.t>m.delay){let best=null,bd=600;for(const e of enemies){if(!e.alive||e.hidden)continue;const d=e.pos.distanceTo(m.pos);if(d<bd&&e.pos.z<m.pos.z+30){bd=d;best=e}}m.tg=best}}
    const S=Math.min(700,280+m.t*520);
    if(m.tg){tA.subVectors(m.tg.pos,m.pos).normalize().multiplyScalar(S);tA.z-=speed*0.85}else tA.set(0,0,-S-speed);
    const ht=Math.max(0,m.t-m.delay),k=m.t<m.delay?0.25:Math.min(14,0.6+ht*ht*16);
    if(m.t<m.delay){
      const u=m.t/m.delay, phase=m.arcPhase+u*2.20;
      tA.set(m.side*(114*Math.cos(u*1.26)+34*Math.sin(phase)),m.lift*96*Math.cos(u*1.72)+28*Math.sin(phase),-speed-118-178*u);
      m.vel.lerp(tA,1-Math.exp(-dt*9));
    }else m.vel.lerp(tA,1-Math.exp(-k*dt));
    u1.copy(m.vel).cross(UPV);if(u1.lengthSq()<1e-4)u1.set(1,0,0);u1.normalize();u2.copy(u1).cross(m.vel).normalize();
    const amp=m.amp*Math.exp(-ht*1.6);m.vel.addScaledVector(u1,Math.cos(m.t*m.w+m.seed)*amp*dt*5).addScaledVector(u2,Math.sin(m.t*m.w+m.seed)*amp*dt*5);
    if(m.pos.y<10&&m.vel.y<0)m.vel.y*=-0.6;
    m.prev.copy(m.pos);m.pos.addScaledVector(m.vel,dt);
    trailSegment(m.prev,m.pos,1.07);const segN=1;
    for(let i=0;i<segN;i++){const f=i/segN;emit(1,lerp(m.prev.x,m.pos.x,f),lerp(m.prev.y,m.pos.y,f),lerp(m.prev.z,m.pos.z,f),rnd(-.6,.6),rnd(-.6,.6)+0.8,rnd(-.6,.6),rnd(.65,1.2),1.1,3.8,0.35,dark)}
    emit(0,m.pos.x,m.pos.y,m.pos.z,0,0,0,0.08,2.2,1,0);
    const part=m.tg?.isPart&&m.tg.alive&&!m.tg.hidden&&m.tg.host.alive?m.tg:null;
    const hitsPart=part&&segDist(m.prev,m.pos,part.pos)<part.r+2.5;
    for(const e of enemies){
      if(!e.alive||e.hidden)continue;
      // A locked hardpoint can sit inside its host's broad core collider.
      // Keep other enemies and intervening physical hardpoints in the collision pass.
      if(part&&(e===part.host||(hitsPart&&e.isPart&&e.host===part.host&&e!==part)))continue;
      if(segDist(m.prev,m.pos,e.pos)<e.r+2.5){m.l=0;explode(m.pos,1.3);hurtEnemy(e,8*mslMult()*(e.isBoss?0.6:e.isMid?0.75:1));break}}
    if(m.l>0&&(m.pos.y<0||(!m.tg&&m.t>m.freeBurst))){m.l=0;explode(m.pos,m.pos.y<0?.8:1.15);}
  }
  missiles=missiles.filter(m=>m.l>0);
  for(const m of emsl){
    m.l+=dt;tA.subVectors(ppos,m.pos).normalize();const a=m.dir.angleTo(tA);if(a>1e-4&&m.l>0.6)m.dir.lerp(tA,Math.min(1,1.25*DIF().bspd*dt/a)).normalize();
    m.prev.copy(m.pos);m.pos.addScaledVector(m.dir,88*DIF().bspd*dt);m.pos.z-=speed*dt;emit(1,m.pos.x,m.pos.y,m.pos.z,0,0,0,0.6,1.2,2.6,0.5,[1,.75,.5]);
    if(P.alive&&segDist(m.prev,m.pos,ppos)<3.6){m.hp=0;damage();explode(m.pos,1)}if(m.l>7){m.hp=0;explode(m.pos,0.8)}
  }
  emsl=emsl.filter(m=>m.hp>0);
  for(const it of items){it.t+=dt;it.pos.z-=speed*0.85*dt;it.pos.x+=(P.x-it.pos.x)*dt*0.4;it.pos.y+=(P.y-it.pos.y)*dt*0.4;it.mesh.position.set(it.pos.x,it.pos.y+Math.sin(it.t*4)*1.2,it.pos.z);
    if(P.alive&&it.pos.distanceTo(ppos)<9.5){it.got=true;collect(it.k)}if(it.pos.z-scrollZ>40)it.got=true;if(it.got)scene.remove(it.mesh)}
  items=items.filter(i=>!i.got);
  const fill=(arr,M,f,near=64)=>{let k=0;for(const b of arr){if(k>=M.instanceMatrix.count)break;if(b.pos.distanceToSquared(camera.position)<near)continue;f(b);dummy.updateMatrix();M.setMatrixAt(k++,dummy.matrix)}M.count=k;M.instanceMatrix.needsUpdate=true};
  const look=(p,d)=>{dummy.position.copy(p);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);tA.copy(p).add(d);dummy.lookAt(tA)};const spin=time*6;
  fill(pBul,pBulM,b=>look(b.pos,b.vel),view===1?900:64);
  fill(eOrb,eOrbM,o=>{dummy.position.copy(o.pos);dummy.rotation.set(spin,spin*0.7,0);dummy.scale.set(1,1,1)});
  fill(eOrb,eOrbCore,o=>{dummy.position.copy(o.pos);dummy.rotation.set(-spin,spin,0);dummy.scale.set(1,1,1)});
  fill(missiles,mslM,m=>look(m.pos,m.vel),view===1?400:36);fill(emsl,emslM,m=>look(m.pos,m.dir));
}
function collect(k){
  SFX.item();const maxed=()=>{score+=1000;P.pts+=150;msg('MAX POWER  +1000 · +150PT','#ffe36a')};
  if(k==='P'){if(P.gunLv<GUN_MAX){P.gunLv++;const G=GUN[P.gunLv];msg((G.thunder?'⚡ ':'')+'GUN → '+G.name,G.thunder?'#9ae8ff':'#ffb09a',true,1.8);if(G.thunder)msg('전격: 표적에서 표적으로 연쇄 감전','#c8f4ff')}else maxed()}
  else if(k==='M'){if(P.mslLv<MSL_MAX){P.mslLv++;P.mslCap=Math.min(24,P.mslCap+3);msg('MISSILE Lv'+P.mslLv+' · 장탄 '+P.mslCap+(salvo()>1?' · 동시발사 ×'+salvo():''),'#9ac4ff',true,1.8)}else maxed();P.msl=P.mslCap}
  else if(k==='S'){if(P.spdLv<SPD_MAX){P.spdLv++;baseSpeed+=10;speedMul=Math.max(speedMul,1.4);burnT=Math.max(burnT,1.2);msg('SPEED UP Lv'+P.spdLv,'#7af0ff',true,1.6);SFX.burner()}else maxed()}
  else if(k==='R'){if(P.agiLv<AGI_MAX){P.agiLv++;msg('AGILITY UP Lv'+P.agiLv,'#d8b0ff',true,1.6);if(P.agiLv===1)msg(isTouch?'배럴롤 해금: 스틱을 좌우로 빠르게 튕기기':'배럴롤 해금: Q / E','#e8d0ff',false,3)}else maxed()}
  else if(k==='H'){if(P.hp<P.maxhp){P.hp=Math.min(P.maxhp,P.hp+30);msg('ENERGY +30','#9affb0')}else maxed()}
  else{score+=1000;gainExp(30);msg('BONUS STAR +1000','#ffe36a')}
}

/* =====================================================================
   입력
   ===================================================================== */
addEventListener('keydown',e=>{
  keys[e.code]=true;if(e.code==='KeyF'&&!e.repeat)triggerRush();
  if(e.code==='Escape'||e.code==='KeyP'){if(state==='play'||state==='clear')togglePause()}
  if(e.code==='KeyV')toggleView();if(e.code==='KeyQ')tryRoll(-1);if(e.code==='KeyE')tryRoll(1);
  if(e.code==='Enter'&&state==='title'&&ov.classList.contains('deck')&&(!document.activeElement||document.activeElement===document.body))start(CFG.startStage);
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
});
addEventListener('keyup',e=>{keys[e.code]=false});
const mouse={gun:false,gunTap:false,missile:false};
function clearFlightInput(){
  silenceTargetTones();
  mouse.gun=mouse.gunTap=mouse.missile=false;
  lockHeld=false;locks=[];lockFull=false;lockT=0;
  for(const code of Object.keys(keys))delete keys[code];
}
const gl=renderer.domElement;
gl.addEventListener('mousedown',event=>{
  if(state!=='play'||paused||event.sourceCapabilities?.firesTouchEvents)return;
  if(event.button===0){mouse.missile=true;lockHeld=true;}
  else if(event.button===2){mouse.gun=true;mouse.gunTap=true;}
  else return;
  event.preventDefault();
});
window.addEventListener('mouseup',event=>{
  if(event.button===0)mouse.missile=false;
  if(event.button===2)mouse.gun=false;
});
window.addEventListener('blur',clearFlightInput);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearFlightInput();});
gl.addEventListener('contextmenu',e=>e.preventDefault());
gl.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;if(!stick.on&&e.clientX<cw*0.6){stick.on=true;stick.id=e.pointerId;stick.ox=e.clientX;stick.oy=e.clientY;stick.x=stick.y=0;try{gl.setPointerCapture(e.pointerId)}catch(_){}}});
let flick={s:0,t:0};
gl.addEventListener('pointermove',e=>{if(stick.on&&e.pointerId===stick.id){let dx=(e.clientX-stick.ox)/55,dy=(e.clientY-stick.oy)/55;const l=Math.hypot(dx,dy);if(l>1){dx/=l;dy/=l}stick.x=dx;stick.y=dy;
  const sg=dx>0.7?1:dx<-0.7?-1:0,now=performance.now();if(sg){if(flick.s===-sg&&now-flick.t<280)tryRoll(sg);if(flick.s!==sg){flick.s=sg;flick.t=now}}}});
const endStick=e=>{if(e.pointerId===stick.id){stick.on=false;stick.id=-1;stick.x=stick.y=0}};gl.addEventListener('pointerup',endStick);gl.addEventListener('pointercancel',endStick);
function hold(id,k){const el=document.getElementById(id);
  const on=e=>{e.preventDefault();audioInit();tch[k]=1;el.classList.add('on');try{el.setPointerCapture(e.pointerId)}catch(_){}};const off=()=>{tch[k]=0;el.classList.remove('on')};
  el.addEventListener('pointerdown',on);el.addEventListener('pointerup',off);el.addEventListener('pointercancel',off);el.addEventListener('lostpointercapture',off);el.addEventListener('contextmenu',e=>e.preventDefault())}
hold('bGun','gun');hold('bMsl','msl');
const mslN=document.getElementById('mslN');const bPause=document.getElementById('bPause');bPause.addEventListener('click',()=>{audioInit();togglePause()});
function toggleView(){view=view===3?1:3}
function setSnd(on){AU.on=on;store.set('snd',on);syncGameMute()}

/* =====================================================================
   화면 흐름: 타이틀 · 메뉴 · 일시정지 · 엔딩 · 종료
   ===================================================================== */
const ov=document.getElementById('ov'),card=document.getElementById('card');
ov.addEventListener('pointerdown',e=>{audioInit();if(ov.classList.contains('deck')&&!e.target.closest('button'))playSong('opening');});
const optRow=(items,selIdx,attr)=>`<div class="row">${items.map((t,i)=>`<button class="opt${i===selIdx?' sel':''}" data-${attr}="${i}">${t}</button>`).join('')}</div>`;
function bindOpts(attr,fn){card.querySelectorAll(`[data-${attr}]`).forEach(b=>b.onclick=()=>{SFX.click();fn(+b.dataset[attr])})}
function perkHTML(){return '<div class="perks">'+PERKS.map(([l,t])=>`<div class="${P.lv>=l?'on':'off'}">LV${l} ${t}</div>`).join('')+'</div>'}
const openingLayer=document.getElementById('film-layer');
const openingVideo=document.getElementById('opening-film');
const chaseFarPlane=camera.far;
let openingSeen=false,afterOpening=null;
let firstSortie=true,entryStarted=0,entryDuration=0,entryShield=false;
let openingFade=null;

function closeFilmLayer(){
  if(openingFade){openingFade.cancel();openingFade=null;}
  openingLayer.classList.remove('flight-dissolve');
  openingLayer.hidden=true;
}
function finishOpening(event){
  if(audioExited||audioAway||!afterOpening)return;
  const next=afterOpening;afterOpening=null;
  const natural=event?.type==='ended';
  const steering=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].filter(code=>keys[code]);
  openingVideo.pause();clearFlightInput();
  next(natural?'ended':'skip');
  if(state==='play')for(const code of steering)keys[code]=true;
  if(!natural||state!=='play'||entryDuration===0){closeFilmLayer();return;}
  // The live scene has already been rendered underneath the film's final decoded frame.
  openingLayer.classList.add('flight-dissolve');
  openingFade=openingLayer.animate([{opacity:1},{opacity:0}],{
    duration:650,easing:'cubic-bezier(.32,.02,.36,1)',fill:'forwards'
  });
  const fade=openingFade;
  fade.onfinish=()=>{if(openingFade===fade)closeFilmLayer();};
}
function playOpening(next){
  if(audioExited||audioAway||afterOpening)return;
  closeFilmLayer();
  openingSeen=true;afterOpening=next;audioInit();playOpeningMusic();
  state='cinematic';openingLayer.hidden=false;openingVideo.muted=!AU.on;
  if(openingVideo.currentTime>.01||openingVideo.ended)openingVideo.currentTime=0;
  openingVideo.play().catch(error=>{if(error.name!=='AbortError'&&afterOpening===next)finishOpening();});
}
openingVideo.addEventListener('ended',finishOpening);
openingVideo.addEventListener('error',finishOpening);
document.getElementById('skip-opening').addEventListener('click',finishOpening);
window.addEventListener('keydown',event=>{
  if(!afterOpening||!['Escape','Enter','Space'].includes(event.code))return;
  event.preventDefault();event.stopImmediatePropagation();finishOpening();
},true);

function openFirstSortie(fromStage){
  let prepared=false;
  const prepare=()=>{
    if(prepared)return;
    prepareSortie(fromStage);
    prepared=true;
  };
  const enter=reason=>{prepare();firstSortie=false;enterFlightFromFilm(reason);};
  playOpening(enter);
  const warm=()=>{
    if(afterOpening!==enter||prepared)return;
    prepare();
    // Prime ground, aircraft and film shaders under an already moving video.
    // Zero simulation time leaves the position, mission distance and shot clocks at launch.
    update(0);renderFilm(scene,camera);
  };
  if(openingVideo.requestVideoFrameCallback){
    const frame=(now,data)=>{
      if(afterOpening!==enter)return;
      if(data.mediaTime<.7)openingVideo.requestVideoFrameCallback(frame);
      else warm();
    };
    openingVideo.requestVideoFrameCallback(frame);
  }else setTimeout(warm,800);
}
function enterFlightFromFilm(reason){
  state='play';paused=false;cloudWhite=0;hitFlash=0;shake=0;
  ov.classList.add('hide');document.body.classList.remove('cine','nogame');
  bPause.style.display='block';P.alive=true;P.inv=2;pMesh.visible=view===3;entryShield=true;
  entryStarted=performance.now();
  entryDuration=reason==='ended'&&!matchMedia('(prefers-reduced-motion: reduce)').matches?1.5:0;
  playCampaignMusic();
  document.body.classList.toggle('film-flight-entry',entryDuration>0);
  update(0);renderFilm(scene,camera);drawHUD(0);
}
function settleFilmCamera(){
  if(!entryDuration||state!=='play')return;
  const t=Math.min(1,(performance.now()-entryStarted)/(entryDuration*1000));
  const remaining=1-t*t*(3-2*t);
  if(view===3){
    // Start above the canopy looking through the horizon; the jet rises into frame as we fall behind it.
    camera.position.y+=8*remaining;
    camera.position.z-=29*remaining;
  }
  if(curTheme.kind==='city'){
    camera.rotateY(-Math.min(.38,.24*camera.aspect)*remaining);
    camera.rotateX(.17*remaining);
  }
  // A turned camera sees the outer edge of the panorama at a greater view-space depth.
  camera.far=chaseFarPlane+1400*remaining;
  camera.fov-=4*remaining;camera.updateProjectionMatrix();
  if(t>=1){entryDuration=0;document.body.classList.remove('film-flight-entry');}
}

const filmDispatch = document.querySelector('.film-dispatch');
const filmSignature = document.querySelector('.film-signature');
function updateOpeningGraphics() {
  const t=openingVideo.currentTime;
  filmDispatch.classList.toggle('is-visible',t>=.11&&t<2.25);
  filmSignature.classList.toggle('is-visible',t>=6.92&&t<7.68);
}
for(const event of ['playing','timeupdate','seeked','ended']){
  openingVideo.addEventListener(event,updateOpeningGraphics);
}

function showBoot(){showTitle();}
let idleT=0;
function showTitle(){
  playSong('opening');idleT=0;state='title';paused=false;bPause.style.display='none';CFG.startStage=Math.min(CFG.startStage,unlocked);
  ov.classList.remove('hide','ttl');ov.classList.add('deck');
  card.innerHTML=`<h1 class="aleste-title"><img src="assets/graphics/pixel-aleste-logo-ba8411b6d8d1dcf7.png" alt="픽셀 알레스트 · PIXEL ALESTE"></h1>
    <p>MISSION ${String(CFG.startStage).padStart(2,'0')} &nbsp;/&nbsp; ${THEMES[CFG.startStage-1].name} &nbsp;·&nbsp; ${DIF().name}</p>
    <div class="deckActions"><button class="go" id="go">출격 &nbsp; ↗</button><button class="go alt" id="opt">비행 설정</button><button class="go alt" id="opening">오프닝</button></div>`;
  document.getElementById('go').onclick=()=>start(CFG.startStage);
  document.getElementById('opt').onclick=()=>{audioInit();showOptions();};
  document.getElementById('opening').onclick=()=>playOpening(()=>{showTitle();playSong('opening');});
}
function showOptions(){
  playSong('story');
  ov.classList.remove('deck');
  idleT=0;state='title';ov.classList.remove('ttl');
  card.innerHTML=`<div class="sub">OPTIONS · 옵션 설정</div>
  <div class="lbl">DIFFICULTY · 난이도</div>${optRow(DIFFS.map(d=>d.name+'<br><small>'+d.kr+'</small>'),CFG.diff,'d')}
  <div class="lbl">START STAGE · 시작 스테이지 (해금 ${unlocked}/${NSTAGE})</div>
  <div class="stg">${THEMES.map((t,i)=>`<button class="opt${i+1===CFG.startStage?' sel':''}" data-s="${i}" ${i+1>unlocked?'disabled':''}>${i+1}. ${t.kr}<br><small>${i+1>unlocked?'LOCKED':t.name}</small></button>`).join('')}</div>
  <div class="lbl">CONTROL · 상하 조작</div>${optRow(['비행기식<br><small>위로 밀면 하강</small>','직관식<br><small>위로 밀면 상승</small>'],CFG.invert?0:1,'c')}
  <div class="lbl">VIEW · 시점</div>${optRow(['3인칭','1인칭'],view===3?0:1,'v')}
  <div class="lbl">SOUND · 사운드</div>${optRow(['ON','OFF'],AU.on?0:1,'n')}
  <div class="lbl">POWER-UP · 파워업</div><div class="items" style="flex-wrap:wrap"><span><i style="background:#ff5a3a">P</i>기총 진화</span><span><i style="background:#3a8aff">M</i>미사일·동시발사</span><span><i style="background:#18b8c8">S</i>스피드</span><span><i style="background:#a05ae0">R</i>회전력·배럴롤</span><span><i style="background:#2fc35a">H</i>장갑</span><span><i style="background:#ffc21a">★</i>보너스</span></div>
  <p style="margin-top:10px;font-size:12px">${isTouch?'왼쪽 화면을 드래그해 이동 · MSL을 눌러 록온하고 떼면 발사 · GUN을 눌러 연사':'WASD 이동 · 마우스 왼쪽 버튼을 누르면 록온, 떼면 미사일 발사 · 오른쪽 버튼을 누르는 동안 기총 연사'}</p>
  <button class="go" id="back">돌아가기</button>`;
  bindOpts('d',i=>{CFG.diff=i;store.set('diff',i);showOptions()});bindOpts('s',i=>{CFG.startStage=i+1;showOptions()});
  bindOpts('c',i=>{CFG.invert=i===0;store.set('invert',CFG.invert);showOptions()});bindOpts('v',i=>{view=i===0?3:1;showOptions()});
  bindOpts('n',i=>{setSnd(i===0);showOptions()});document.getElementById('back').onclick=()=>{SFX.click();showTitle()};ov.classList.remove('hide');
}
function togglePause(){ov.classList.remove('ttl');
  if(state!=='play'&&state!=='clear')return;
  paused=!paused;clearFlightInput();
  playSong('stage');
  if(!paused){ov.classList.add('hide');return}
  card.innerHTML=`<div class="sub">PAUSE</div><h1 style="font-size:30px">STAGE ${stage}</h1><p>${curTheme.name} · ${curTheme.kr} · ${DIF().name}</p>
  <div class="lbl">PILOT LV ${P.lv} 특전</div>${perkHTML()}
  <div class="lbl">CONTROL · 상하 조작</div>${optRow(['비행기식','직관식'],CFG.invert?0:1,'c')}
  <div class="lbl">VIEW · SOUND</div>${optRow(['3인칭','1인칭'],view===3?0:1,'v')}${optRow(['사운드 ON','사운드 OFF'],AU.on?0:1,'n')}
  <button class="go" id="res">계속하기</button><br><button class="go alt" id="ret">타이틀로</button><button class="go dark" id="quit">게임 종료</button>`;
  bindOpts('c',i=>{CFG.invert=i===0;store.set('invert',CFG.invert);paused=false;togglePause()});
  bindOpts('v',i=>{view=i===0?3:1;paused=false;togglePause()});bindOpts('n',i=>{setSnd(i===0);paused=false;togglePause()});
  document.getElementById('res').onclick=togglePause;
  document.getElementById('ret').onclick=()=>{toTitle()};document.getElementById('quit').onclick=quitGame;
  ov.classList.remove('hide');
}
function toTitle(){clearWorld();stage=1;applyTheme(THEMES[0]);STAGE_LEN=6000;buildWorld(THEMES[0]);for(const e of enemies)scene.remove(e.mesh);enemies=[];pMesh.visible=true;P.alive=true;showTitle();playSong('opening')}
function quitGame(){silenceGameAudio(true);ov.classList.remove('ttl');
  if(score>hi){hi=score;store.set('hi',hi)}
  stopSong();clearWorld();paused=false;state='quit';bPause.style.display='none';
  try{window.close()}catch(e){}
  card.innerHTML=`<div class="sub">GAME OVER · SYSTEM SHUTDOWN</div><h1 style="font-size:28px">게임을 종료했습니다</h1><p>HI-SCORE <b>${hi}</b><br>창을 닫거나, 다시 시작할 수 있어요.</p><button class="go alt" id="again">다시 켜기</button>`;
  document.getElementById('again').onclick=()=>{audioExited=false;audioAway=document.hidden;syncGameMute();audioInit();toTitle();};ov.classList.remove('hide');
}
function showOver(){ov.classList.remove('ttl');
  if(score>hi){hi=score;store.set('hi',hi)}bPause.style.display='none';
  card.innerHTML=`<div class="sub">GAME OVER</div><div class="big">${score}</div><p>STAGE <b>${stage}</b> ${THEMES[(stage-1)%NSTAGE].kr} · PILOT LV <b>${P.lv}</b> · ${DIF().name}<br>HI-SCORE ${hi}</p>
  <button class="go" id="go">CONTINUE</button><br><button class="go alt" id="tt">타이틀로</button><button class="go dark" id="quit">게임 종료</button>`;
  document.getElementById('go').onclick=()=>{const s=stage;start(s)};document.getElementById('tt').onclick=toTitle;document.getElementById('quit').onclick=quitGame;
  ov.classList.remove('hide');state='overdone';playSong('over');
}

const victoryLayer=document.getElementById('victory-layer'),victoryVideo=document.getElementById('victory-film');
const victoryPlay=document.getElementById('play-victory'),victorySkip=document.getElementById('skip-victory');
const victoryDialogue=[[6.048,7.968]];
const victoryCaptions=[[6.218, 8.108, "아~ 재밌었다~"]],victorySub=document.getElementById('victory-subtitle');
let victoryActive=false,victoryPlayback=0,victoryMixFrame=0,victoryGain=null,victoryBaseVolume=1;
function prepareVictoryMix(){
  victoryBaseVolume=musicPlayer.volume;
  if(victoryGain||!AU.ctx)return;
  // The media source keeps its decoder, position and current playlist selection.
  // A gain node also provides dialogue ducking on mobile browsers with fixed HTML media volume.
  try{
    const gain=AU.ctx.createGain(),source=AU.ctx.createMediaElementSource(musicPlayer);
    source.connect(gain);gain.connect(AU.ctx.destination);victoryGain=gain;
  }catch{}
}
function frameVictoryPortrait(t){
  const performance=t-89/24;
  let pan=53.5;
  if(performance>=7.5)pan=50;
  else if(performance>=0&&victoryVideo.videoWidth){
    const ease=(a,b)=>{const u=Math.max(0,Math.min(1,(performance-a)/(b-a)));return u*u*(3-2*u);};
    // Follow the recorded tilt from the eyes to the approaching controller.
    // It moves back toward frame centre after her fingertips let go.
    const focus=.472-.012*ease(2.5,3.10)+.254*ease(3.25,4.42)-.068*ease(4.45,6.00)-.013*ease(6.1,7.35);
    const visible=victoryVideo.clientWidth/victoryVideo.clientHeight*victoryVideo.videoHeight/victoryVideo.videoWidth;
    pan=visible>=1?50:Math.max(0,Math.min(100,100*(focus-visible/2)/(1-visible)));
  }
  const value=Number(pan.toFixed(2))+'%';
  if(victoryVideo.style.getPropertyValue('--victory-pan')!==value)victoryVideo.style.setProperty('--victory-pan',value);
}
function mixVictoryMusic(){
  if(!victoryActive)return;
  const t=victoryVideo.currentTime;
  frameVictoryPortrait(t);
  const caption=vicCaptionAt(t);
  if(victorySub.textContent!==caption)victorySub.textContent=caption;
  victorySub.hidden=!caption;
  let emphasis=0;
  for(const [start,end] of victoryDialogue){
    emphasis=Math.max(emphasis,Math.max(0,Math.min(1,(t-start+.28)/.28,(end+.55-t)/.55)));
  }
  const level=1-.78*emphasis;
  if(victoryGain)victoryGain.gain.value=level;
  else musicPlayer.volume=victoryBaseVolume*level;
  victoryMixFrame=requestAnimationFrame(mixVictoryMusic);
}
function vicCaptionAt(time){
  const cue=victoryCaptions.find(([start,end])=>start<=time&&time<end);
  return cue?cue[2]:'';
}
function closeVictoryFilm(){
  if(!victoryActive)return;
  victoryActive=false;victoryPlayback++;
  cancelAnimationFrame(victoryMixFrame);
  if(victoryGain){
    const param=victoryGain.gain,now=AU.ctx.currentTime;
    param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);param.linearRampToValueAtTime(1,now+.22);
  }else musicPlayer.volume=victoryBaseVolume;
  victoryVideo.pause();victoryLayer.hidden=true;victoryPlay.hidden=true;victorySub.hidden=true;
}
function finishVictoryFilm(){
  if(!victoryActive||audioAway||audioExited)return;
  closeVictoryFilm();document.body.classList.remove('cine');showEnding();
  document.getElementById('go')?.focus({preventScroll:true});
}
function resumeVictoryFilm(){
  if(!victoryActive||audioAway||audioExited)return;
  if(victoryVideo.ended){finishVictoryFilm();return;}
  const request=++victoryPlayback;
  victoryPlay.hidden=true;
  victoryVideo.play().catch(error=>{
    if(request!==victoryPlayback||!victoryActive||audioAway||audioExited||error.name==='AbortError')return;
    if(error.name==='NotAllowedError'){victoryPlay.hidden=false;victoryPlay.focus({preventScroll:true});}
    else finishVictoryFilm();
  });
}
function showVictoryFilm(){
  if(victoryActive||audioExited||audioAway||state!=='debrief'||!DB.last)return;
  victoryActive=true;state='victoryFilm';clearFlightInput();
  ov.classList.add('hide');bPause.style.display='none';document.body.classList.add('cine');
  victoryLayer.hidden=false;victoryPlay.hidden=true;victoryVideo.muted=!AU.on;
  if(victoryVideo.ended||victoryVideo.currentTime>.01)victoryVideo.currentTime=0;
  victorySkip.focus({preventScroll:true});
  playCampaignMusic();prepareVictoryMix();mixVictoryMusic();resumeVictoryFilm();
}
victoryVideo.addEventListener('ended',finishVictoryFilm);
victoryVideo.addEventListener('error',finishVictoryFilm);
victoryLayer.addEventListener('click',event=>{
  event.stopPropagation();
  if(event.target===victoryPlay)resumeVictoryFilm();else finishVictoryFilm();
});
window.addEventListener('keydown',event=>{
  if(!victoryActive||!['Escape','Enter','Space'].includes(event.code))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(event.repeat)return;
  if(!victoryPlay.hidden&&event.code!=='Escape')resumeVictoryFilm();else finishVictoryFilm();
},true);

function showEnding(){ov.classList.remove('ttl');
  if(score>hi){hi=score;store.set('hi',hi)}state='ending';bPause.style.display='none';playSong('ending');
  card.innerHTML=`<div class="sub">ALL MISSIONS COMPLETE</div><h1 class="victory-thanks">플레이 해주셔서 감사합니다</h1><p class="victory-studio">제작 <b>Creative Labs</b></p><div class="big" style="font-size:34px">${score}</div>
  <section class="credit-window" tabindex="0" aria-label="엔딩 크레디트"><div class="cred credit-roll"><em>OPERATION</em>${THEMES.map(t=>t.kr).join(' · ')}<em>DEFEATED</em>${BOSSES.map(b=>b.name.split(' "')[0]).join(' · ')}<em>PILOT</em>LEVEL ${P.lv} · ${DIF().name} · LOOP ${loop}<em>MUSIC</em>인게임 통합 01<br>인게임 통합 02<br>옵션 설정 스토리라인 01<br>엔딩곡 01<em>제작</em>Creative Labs<em>플레이 해주셔서 감사합니다</em></div></section>
  <button class="go" id="go">NEXT LOOP</button><br><button class="go alt" id="tt">타이틀로</button><button class="go dark" id="quit">게임 종료</button>`;
  document.getElementById('go').onclick=()=>{loop++;stage=1;P.hp=P.maxhp;P.msl=P.mslCap;buildStage();startIntro('launch')};
  document.getElementById('tt').onclick=toTitle;document.getElementById('quit').onclick=quitGame;ov.classList.remove('hide');
}
function start(fromStage){
  if(!openingSeen){openFirstSortie(fromStage);return;}
  prepareSortie(fromStage);
  if(firstSortie){firstSortie=false;enterFlightFromFilm('skip');}
  else startIntro('launch');
}
function prepareSortie(fromStage){
  ov.classList.remove('deck');
  audioInit();
  Object.assign(P,{pts:0,enLv:0,hp:hullCapacity(),maxhp:hullCapacity(),inv:2,gunLv:1,mslLv:1,spdLv:0,agiLv:0,rollT:0,rollCd:0,mslCap:8,msl:8,regen:0,lv:1,exp:0,next:150,fireT:0,alive:true,repairT:0});
  score=0;stage=campaignStage(typeof fromStage==='number'?fromStage:CFG.startStage);loop=1;msgs=[];hitFlash=0;combo=0;paused=false;seenTypes=new Set();
  buildStage();
}
function buildStage(){
  hullStatus.band=0;hullStatus.noticeTime=0;
  entryShield=false;entryDuration=0;camera.far=chaseFarPlane;document.body.classList.remove('film-flight-entry');
  clearFlightInput();soundBarrier.armed=true;soundBarrier.elapsed=10;rush.cool=0;rush.focus=0;
  clearWorld();
  const sourceStage=stageSourceNumber(),th=THEMES[stage-1];applyTheme(th);
  scrollZ=0;stageDist=0;baseSpeed=120+Math.min(48,(sourceStage-1)*6)+P.spdLv*10;speed=baseSpeed;speedMul=1;burnT=0;bossState='none';bossT=0;bossDef=null;
  STAGE_LEN=5200+Math.min(2400,(sourceStage-1)*250);stageDrops=0;stageKills=0;lastDrop=-99;
  buildWorld(th);obst.sort((a,b)=>b.z-a.z);obIdx=0;
  events=[];let d=320;const pool=stagePool();
  while(d<STAGE_LEN-300){let type=pick(pool);if(stage===1&&d<800)type=d<550?'headon':'swarm';events.push({d,type});if(Math.random()<0.18+sourceStage*0.02)events.push({d:d+40,type:pick(pool)});d+=rnd(110,190)/(1+(sourceStage-1)*0.07)}
  events.push({d:STAGE_LEN*0.3,type:'burner'},{d:STAGE_LEN*0.66,type:'burner'},{d:STAGE_LEN*0.48,type:'midboss'});midE=null;
  if(!['sky','strato','sea'].includes(th.kind)){for(let z=-650;z>-STAGE_LEN+300;z-=rnd(240,380)){const r=Math.random();groundTarget(r<0.35?'walker':r<0.6?'mlrs':'turret',rnd(-125,125),0,z,r>=0.6?{pop:true}:{})}}events.sort((a,b)=>a.d-b.d);
  P.x=0;P.y=50;P.vx=P.vy=0;
  msg('STAGE '+stage+(loop>1?' · LOOP '+loop:''),'#ffe36a',true,2.8);msg(th.name+' · '+th.kr,'#e6ffea',false,2.8);
  const hint={city:'고가도로 밑을 통과하면 보너스 · 빌딩 충돌 주의',river:'다리 밑을 통과하면 보너스!',canyon:'바위 기둥을 피하거나 위로 넘어가라!',sky:'노란 링을 통과하면 부스트!',strato:'노란 링을 통과하면 부스트!',ruins:'최종 결전 — 거대 로봇이 기다린다'}[th.kind];if(hint)msg(hint,'#7affd8',false,3);
}

/* =====================================================================
   갱신
   ===================================================================== */
function update(rdt){
  if(paused)return;
  if(state==='play'){rush.cool=Math.max(0,rush.cool-rdt);rush.focus=Math.max(0,rush.focus-rdt);}
  if(slowT>0){slowT-=rdt;timeScale=lerp(timeScale,0.35,Math.min(1,rdt*12))}else timeScale=lerp(timeScale,1,Math.min(1,rdt*4));
  const dt=rdt*timeScale;time+=dt;
  if(burnT>0){burnT-=dt;if(burnT<=0)speedMul=1}
  speed=lerp(speed,baseSpeed*speedMul,Math.min(1,dt*2.5));
  if(state==='crash')speed=lerp(speed,baseSpeed*0.6,Math.min(1,dt));
  if(state!=='ending'&&state!=='quit'){scrollZ-=speed*dt;if(state==='play')stageDist+=speed*dt}
  if(state==='play'){
    while(events.length&&stageDist>=events[0].d&&bossState==='none')spawnEvent(events.shift());
    if(bossState==='none'&&stageDist>=STAGE_LEN){bossState='warn';bossT=0;SFX.warn()}
    if(bossState==='warn'){bossT+=dt;if(bossT>3){bossState='fight';spawnBoss();playSong('boss',THEMES[(stage-1)%NSTAGE].tr>2?2:0)}}
    if(bossState==='dead'){bossT+=dt;
      if(bossT<1.8&&Math.random()<dt*12&&boss)explode(tA.copy(boss.pos).add(tB.set(rnd(-25,25),rnd(-6,6),rnd(-25,25))),3);
      if(bossT>2.4){clearBeams();for(const z of zones)scene.remove(z.mesh);zones=[];state='clear';clearT=0;clearRTB=0;const bonus=Math.round(P.hp)*50;score+=bonus;msg('MISSION COMPLETE','#ffe36a',true,4);msg('ENERGY BONUS +'+bonus,'#e6ffea',false,4);eOrb=[];emsl=[];playSong('clear');
        if(loop===1&&stage<NSTAGE&&stage+1>unlocked){unlocked=stage+1;store.set('unlock',unlocked);msg('STAGE '+(stage+1)+' UNLOCKED','#7affd8',false,4)}}}
  }
  if(state==='clear'){clearT+=dt;P.inv=1;if(clearT>0.9&&!clearRTB){clearRTB=1;msg('RTB — 모함 합류 고도로 상승','#9ad8ff',true,2.4);SFX.burner()}if(clearT>3.6)startReturn()}
  if(state==='over'){overT+=rdt;if(overT>2.6)showOver()}
  updPlayer(dt);updEnemies(dt);updShots(dt);updZones(dt);advanceWeather(dt);updParts(dt);advanceEffects(dt);updateTrails();updateMuzzles(dt);updateImpactFront(dt);flightWater.update(flightWeather);
  updateHullStatus(rdt);
  if(comboT>0){comboT-=dt;if(comboT<=0){if(combo>=3){const b=combo*50;score+=b;msg(combo+' CHAIN!  +'+b,'#ffe36a',true,1.6)}combo=0}}
  for(const m of msgs)m.a+=rdt;msgs=msgs.filter(m=>m.a<m.dur);for(const p of pops)p.t+=rdt;pops=pops.filter(p=>p.t<0.9);for(const b of bolts)b.t+=rdt;bolts=bolts.filter(b=>b.t<0.13);
  hitFlash=Math.max(0,hitFlash-rdt*2);shake=Math.max(0,shake-rdt*1.4);fovKick=Math.max(0,fovKick-rdt*(burnT>0?2:8));
  if(state==='play'&&curTheme.kind==='ruins'){for(let i=0;i<2;i++){const x=rnd(-320,320),z=scrollZ-rnd(150,900);emit(1,x,rnd(0,10),z,rnd(-3,3),rnd(14,26),0,rnd(2.5,4),5,16,0.3,[.3,.26,.26]);if(Math.random()<0.5)emit(2,x,rnd(5,30),z,rnd(-8,8),rnd(20,40),0,1.2,1.2,1.2,0.5)}}
  for(const r of rings)r.mesh.rotation.z+=dt*1.5;
  const wn=Math.round((speed/120)*(burnT>0?6:2.5));for(let i=0;i<wn;i++)emit(4,P.x+rnd(-90,90),P.y+rnd(-30,40),scrollZ-rnd(30,260),0,0,0,0.7,0.5,0.5,0);
  let cwv=0;for(const c of pathClouds){const dz=c.z-camera.position.z;if(dz<-60||dz>40)continue;const d=Math.hypot(c.x-camera.position.x,(c.y-camera.position.y)*1.5,dz);cwv=Math.max(cwv,clamp(1.6-d/40,0,1))}
  cloudWhite=lerp(cloudWhite,cwv,Math.min(1,rdt*10));
  if(groundFrames[1])ground.material.map=groundFrames[Math.floor(time*2.5)%2];
  ground.position.set(Math.round(P.x/gridStep)*gridStep,0,Math.round(scrollZ/gridStep)*gridStep);river.position.z=Math.round(scrollZ/16)*16;
  for(const c of chunks)c.mesh.visible=c.near>=scrollZ-1150&&c.far<=scrollZ+160;
  const sx=(Math.random()-.5)*shake*3,sy=(Math.random()-.5)*shake*3,vib=(speedMul>1.1?(Math.random()-.5)*0.4:0);
  camera.fov=baseFov+fovKick+(speedMul-1)*10;camera.updateProjectionMatrix();
  if(view===3){camera.position.set(P.x*0.82+sx,P.y+10+sy+vib,scrollZ+33-(speedMul-1)*6);camera.lookAt(P.x*0.9,P.y+1.5,scrollZ-70);camera.rotateZ(-P.vx*0.0030)}
  else{camera.position.set(P.x+sx,P.y+1.6+sy+vib,scrollZ-3);camera.lookAt(P.x+P.vx*0.25,P.y+1.6+P.vy*0.35,scrollZ-100);camera.rotateZ(-P.vx*0.004)}
  settleFilmCamera();updateMach(rdt);pressureShake();positionSky();camera.updateMatrixWorld();pMat.uniforms.scale.value=rh/(2*Math.tan(camera.fov*D2R/2));
}

/* =====================================================================
   HUD
   ===================================================================== */
const G='#dbfeef',RED='#ff5a4f',YEL='#ffe36a',scr={x:0,y:0,front:true},vv=new V3();
const probe=document.createElement('div');probe.style.cssText='position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden';document.body.appendChild(probe);
let safeT=0;const readSafe=()=>{safeT=probe.getBoundingClientRect().height||0};readSafe();addEventListener('resize',readSafe);
function toS(w,o){vv.copy(w).applyMatrix4(camera.matrixWorldInverse);o.front=vv.z<0;o.lx=vv.x;o.ly=vv.y;vv.applyMatrix4(camera.projectionMatrix);o.x=(vv.x+1)/2*cw;o.y=(1-vv.y)/2*ch;return o}
function ln(g,a,b,c,d){g.beginPath();g.moveTo(a,b);g.lineTo(c,d);g.stroke()}
function tape(g,x,y,h,val,step,label,right){
  g.save();g.beginPath();g.rect(x-34,y-h/2,68,h);g.clip();const pxPer=h/(step*8);
  for(let v=Math.floor((val-step*5)/step)*step;v<=val+step*5;v+=step){const yy=y-(v-val)*pxPer,major=v%(step*2)===0;
    if(right){ln(g,x-30,yy,x-30+(major?10:5),yy);if(major){g.textAlign='left';g.fillText(v,x-16,yy)}}else{ln(g,x+30,yy,x+30-(major?10:5),yy);if(major){g.textAlign='right';g.fillText(v,x+16,yy)}}}
  g.restore();g.textAlign='center';g.fillStyle='rgba(0,0,0,.45)';g.fillRect(x-30,y-11,60,22);g.fillStyle=G;g.strokeRect(x-30,y-11,60,22);
  g.font='800 14px ui-monospace,monospace';g.fillText(Math.round(val),x,y+1);g.font='700 10px ui-monospace,monospace';g.fillText(label,x,y-h/2-9);g.font='600 10px ui-monospace,monospace';
}
const lines=[];for(let i=0;i<46;i++)lines.push({a:Math.random()*6.283,r:Math.random(),w:rnd(0.6,1.6)});
function arrow(g,cx,cy,a,r,col,s=9){const ax=cx+Math.cos(a)*r,ay=cy-Math.sin(a)*r;g.fillStyle=col;g.beginPath();g.moveTo(ax+Math.cos(a)*s*1.3,ay-Math.sin(a)*s*1.3);g.lineTo(ax+Math.cos(a+2.5)*s,ay-Math.sin(a+2.5)*s);g.lineTo(ax+Math.cos(a-2.5)*s,ay-Math.sin(a-2.5)*s);g.closePath();g.fill()}
function weakPips(g,h,cx,y){if(!h.weak)return;const n=h.weak.length;g.font='800 8px ui-monospace,monospace';g.textAlign='right';g.fillStyle=h.weakN?'#ffe36a':'#7affd8';g.fillText(h.weakN?'WEAK':'CORE EXPOSED ×1.4',cx-n*6-4,y+3);
  h.weak.forEach((w,i)=>{const x=cx-n*6+i*12+6;g.strokeStyle='#ffe36a';g.lineWidth=1.2;g.beginPath();g.moveTo(x,y-4);g.lineTo(x+4,y);g.lineTo(x,y+4);g.lineTo(x-4,y);g.closePath();if(w.alive){g.fillStyle='#ff6a3a';g.fill()}g.stroke()});g.textAlign='center'}
function drawLockSys(g,lockIdx){
  const cap=lockCap(),avail=Math.min(P.msl,cap),n=locks.length;
  // 1) 록온 라인 + 번호 태그(누를 때)
  toS(ppos,scr);const px=scr.x,py=scr.y;
  if(lockHeld||lockFA){g.save();
    const list=lockHeld?[...lockIdx.keys()]:lockFA.tg.filter(e=>e&&e.alive);
    for(const e of list){toS(e.pos,scr);if(!scr.front)continue;const tx=scr.x,ty=scr.y;
      if(lockHeld){g.strokeStyle='#ff5a4a';g.globalAlpha=0.55;g.lineWidth=1;g.setLineDash([3,5]);g.lineDashOffset=-time*60;g.beginPath();g.moveTo(px,py);g.lineTo(tx,ty);g.stroke();g.setLineDash([]);g.globalAlpha=1;
        const k=lockIdx.get(e);g.fillStyle='#ff3a2a';g.fillRect(tx+9,ty-21,15,11);g.fillStyle='#fff';g.font='900 9px ui-monospace,monospace';g.textAlign='center';g.fillText(k,tx+16.5,ty-12.5)}
      else{const a=Math.max(0,1-lockFA.t/1.2);g.strokeStyle='rgba(255,180,64,'+a+')';g.lineWidth=1.5;g.beginPath();g.arc(tx,ty,12+lockFA.t*20,0,6.28);g.stroke()}}
    g.restore()}
  // 2) 게이지
  const W=Math.min(cw*0.5,cap*11),sw=W/cap,x0=cw*0.44-W/2,y0=ch-30;
  g.fillStyle='rgba(0,8,4,.42)';g.beginPath();g.roundRect?g.roundRect(x0-38,y0-6,W+84,32,8):g.rect(x0-38,y0-6,W+84,32);g.fill();
  g.font='800 9px ui-monospace,monospace';g.textAlign='right';g.fillStyle=lockHeld?'#ffe36a':'#b6ffc4aa';g.fillText('LOCK',x0-6,y0+8);
  let fired=0,refill=1;if(lockFA){const T=lockFA.t,step=0.022*lockFA.sv,endT=lockFA.n*step+0.25;fired=Math.min(lockFA.n,Math.floor(T/step)+1);if(T>endT)refill=Math.min(1,(T-endT)/0.35)}
  for(let i=0;i<cap;i++){const x=x0+i*sw,w=sw-2.5;let col,fill=false;
    if(lockFA){if(i<lockFA.n){if(i<fired&&refill<1&&(lockFA.t-i*0.022*lockFA.sv)<0.12){col='#ffffff';fill=true}else if(refill<1){col='#ff8a40';fill=false}else{col='#b6ffc4';fill=false}}
      else col=i<avail?'#b6ffc4':'#3a4a40';
      if(refill>0&&refill<1&&i/cap<refill&&i<avail){col='#7affd8';fill=true}}
    else if(i<n){col=n>=avail?(Math.floor(time*10)%2?'#ff3a2a':'#ffe36a'):'#ff5a3a';fill=true}
    else col=i<avail?(lockHeld?'#ffe36a':'#b6ffc4'):'#3a4a40';
    g.beginPath();g.moveTo(x+3,y0);g.lineTo(x+w+3,y0);g.lineTo(x+w,y0+10);g.lineTo(x,y0+10);g.closePath();
    if(fill){g.fillStyle=col;g.fill()}else{g.strokeStyle=col;g.lineWidth=1.2;g.globalAlpha=i<avail?0.85:0.5;g.stroke();g.globalAlpha=1}}
  g.textAlign='left';g.font='900 12px ui-monospace,monospace';
  if(lockFA&&refill<1){g.fillStyle='#ff8a40';g.fillText(lockFA.t<lockFA.n*0.022*lockFA.sv+0.25?'FIRE!':'RELOAD',x0+W+6,y0+9)}
  else if(lockHeld&&n>=avail&&n>0){g.fillStyle=Math.floor(time*10)%2?'#ff3a2a':'#ffe36a';g.fillText('FULL',x0+W+6,y0+9)}
  else{g.fillStyle=lockHeld?'#ffe36a':'#d6ffe0';g.fillText(n+'/'+avail,x0+W+6,y0+9)}
  g.font='700 8px ui-monospace,monospace';g.fillStyle='#b6ffc499';g.textAlign='left';g.fillText('MSL '+P.msl+'/'+P.mslCap+(salvo()>1?'  SALVO ×'+salvo():'')+'  MAX LOCK '+cap,x0,y0+21);
}
function drawDirAlert(g,cx,cy,top,rdt){if(!dirAlert)return;dirAlert.t-=rdt;if(dirAlert.t<=0){dirAlert=null;return}
  if(Math.floor(dirAlert.t*7)%2===0)return;const d=dirAlert.d,c='#ff6a4a';g.fillStyle=c;g.strokeStyle=c;g.lineWidth=2;g.textAlign='center';g.font='900 12px ui-monospace,monospace';
  const chev=(x,y,a)=>{g.save();g.translate(x,y);g.rotate(a);for(let i=0;i<2;i++){g.beginPath();g.moveTo(-9,i*7-4);g.lineTo(0,i*7+3);g.lineTo(9,i*7-4);g.stroke()}g.restore()};
  const yT=top+92,yB=ch-150;
  if(d==='above'||d==='all'){chev(cx,yT,Math.PI);g.fillText('▲ '+(d==='all'?dirAlert.txt:dirAlert.txt),cx,yT+22)}
  if(d==='below'||d==='all'){chev(cx,yB,0);if(d!=='all')g.fillText('▼ '+dirAlert.txt,cx,yB-10)}
  if(d==='rear'){chev(cx,yB,0);chev(cx,yB+12,0);g.fillText('⚠ '+dirAlert.txt+' ⚠',cx,yB-10)}
  if(d==='all'){chev(16,cy,Math.PI/2);chev(cw-16,cy,-Math.PI/2)}
  if(d==='front'){g.fillText(dirAlert.txt,cx,yT+22)}}
const flightUI={mint:'#9dffbd',gold:'#ffcc64',cyan:'#77e6ff',red:'#ff6442',ink:'rgba(6,14,23,.77)'};
function hudText(g,text,x,y,size,color,align='left',italic=false){
  g.fillStyle=color;g.textAlign=align;g.textBaseline='middle';
  g.font=(italic?'italic 900 ':'700 ')+size+'px "Arial Narrow",Arial,"Malgun Gothic",sans-serif';
  g.fillText(text,x,y);
}
function hudStrip(g,x,y,w,h,color,slant=8){
  g.fillStyle=color;g.beginPath();g.moveTo(x+slant,y);g.lineTo(x+w,y);g.lineTo(x+w-slant,y+h);g.lineTo(x,y+h);g.closePath();g.fill();
}
function cellMeter(g,x,y,w,h,count,percent,color){
  const cell=w/count;
  for(let i=0;i<count;i++)hudStrip(g,x+i*cell,y,cell-1,h,i/count<percent?color:'rgba(189,211,215,.25)',Math.min(3,cell*.3));
}
// Bitmap score digits preserve the cartridge display at both HUD scales.
const scoreTiles=['75557','26227','71747','71717','55711','74717','74757','71111','75757','75717'].map(digit=>{
  const path=new Path2D();
  [...digit].forEach((bits,y)=>{
    for(let x=0;x<3;x++)if(Number(bits)&(4>>x))path.rect(x,y,1,1);
  });
  return path;
});
function drawArcadeScore(g,number,right,mid,cell){
  const value=String(number).padStart(8,'0');
  g.save();g.translate(Math.round(right-cell*(value.length*4-1)),Math.round(mid-2.5*cell));
  g.scale(cell,cell);g.shadowBlur=0;
  for(const digit of value){
    g.fillStyle='#547285';g.translate(0,.35);g.fill(scoreTiles[digit]);
    g.translate(0,-.35);g.fillStyle='#fff2ca';g.fill(scoreTiles[digit]);g.translate(4,0);
  }
  g.restore();
}
function tacticalRadar(g,x,y,r){
  g.save();g.translate(x,y);g.strokeStyle='#98eeb67a';g.lineWidth=1;
  g.fillStyle='rgba(8,26,24,.44)';g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.fill();g.stroke();
  g.beginPath();g.arc(0,0,r*.53,0,Math.PI*2);g.stroke();
  ln(g,-r,0,r,0);ln(g,0,-r,0,r);
  g.fillStyle='#91ffa021';g.beginPath();g.moveTo(0,0);g.arc(0,0,r,time*1.6,time*1.6+.65);g.fill();
  for(const e of enemies){
    if(e.hidden||!e.alive)continue;
    let dx=(e.pos.x-P.x)/650*r,dz=(e.pos.z-scrollZ)/650*r;const d=Math.hypot(dx,dz);
    if(d>r)continue;
    g.fillStyle=e.lockN||e.isBoss?flightUI.red:flightUI.mint;g.fillRect(dx-1.5,dz-1.5,e.isBoss?5:3,3);
  }
  g.fillStyle='white';g.beginPath();g.moveTo(0,-4);g.lineTo(3,3);g.lineTo(-3,3);g.fill();g.restore();
}
function drawBossFormationHUD(g,upper,margin,sideWidth){
  const count=bossRoster.length, gap=4;
  const centerSpace=cw-2*(sideWidth+margin+10);
  const beneathScore=centerSpace<count*100;
  // Leave room to the right of the lower row for the pause button and combo counter.
  const width=Math.min(count*145+gap*(count-1),beneathScore?cw-2*(margin+43):centerSpace);
  const slot=(width-gap*(count-1))/count, top=upper+(beneathScore?47:0);
  bossRoster.forEach((enemy,index)=>{
    const left=(cw-width)/2+index*(slot+gap), center=left+slot/2;
    const callsign=enemy.bossDef.name.split('"')[1] || enemy.bossDef.name;
    const health=clamp(enemy.hp/enemy.maxhp,0,1);
    const accent=enemy.alive?flightUI.gold:'#9fadb1';
    hudStrip(g,left,top,slot,39,'rgba(5,14,23,.89)',4);
    hudText(g,callsign,center,top+9,slot>=108?12:10,accent,'center',true);
    cellMeter(g,left+5,top+17,slot-10,5,16,enemy.alive?health:0,flightUI.red);
    if(!enemy.alive||!enemy.weakN){
      hudText(g,enemy.alive?'CORE ×1.4':'격파',center,top+31,9,
        enemy.alive?flightUI.mint:accent,'center');
      return;
    }
    enemy.weak.forEach((weak,i)=>{
      const x=center+(i-(enemy.weak.length-1)/2)*9;
      g.fillStyle=weak.alive?flightUI.gold:'#566872';
      g.fillRect(x-2.5,top+28,5,5);
    });
  });
}

const hullStatus={band:0,noticeTime:0};
function hullBand(ratio){return ratio<=.30?2:ratio<=.50?1:0;}
function updateHullStatus(dt){
  if(state!=='play'||!P.alive||paused)return;
  const band=hullBand(P.hp/P.maxhp);
  hullStatus.noticeTime=Math.max(0,hullStatus.noticeTime-dt);
  if(band>hullStatus.band){
    hullStatus.noticeTime=band===2?3.0:2.3;
    if(SFX.ok()&&AU.ctx.state==='running'&&AU.master.gain.value>0&&!document.hidden){
      const now=AU.ctx.currentTime,critical=band===2;
      tri(now,critical?370:470,.16,.14,AU.sfx,critical?225:340);
      if(critical)tri(now+.22,280,.23,.14,AU.sfx,155);
    }
  }else if(band<hullStatus.band)hullStatus.noticeTime=0;
  hullStatus.band=band;
}
function drawHullGauge(g,x,base,w,compact){
  const level=Math.max(0,Math.min(1,P.hp/P.maxhp)),band=hullBand(level);
  const color=band===2?'#ff785d':band===1?'#ffd06c':'#9bffcc';
  const left=x+8, stripWidth=w-16, y=base-17;
  hudStrip(g,x,y,w,39,'rgba(5,14,23,.92)',6);
  hudText(g,band===2?'체력 위험':band===1?'체력 주의':'기체 체력',left,y+11,compact?11:12,color);
  hudText(g,Math.ceil(level*100)+'%',x+w-8,y+10,compact?15:19,'#f7fbff','right',true);
  // Twenty cells give 30% and 50% exact boundaries at all viewport sizes.
  cellMeter(g,left,y+23,stripWidth,compact?9:11,20,level,color);
  if(state!=='play'||!hullStatus.noticeTime||!band)return;
  g.save();g.globalAlpha=Math.min(1,hullStatus.noticeTime*3);
  const bannerY=base-91;
  hudStrip(g,x,bannerY,w,21,band===2?'#832e25':'#6c4c15',4);
  g.fillStyle=color;g.fillRect(x+2,bannerY+3,3,15);
  hudText(g,band===2?'ALERT  ·  위험 30%':'ALERT  ·  주의 50%',left+1,bannerY+11,
    compact?10:12,'#fff9e5');
  g.restore();
}
function drawFlightDeck(g,top){
  const compact=cw<680, margin=compact?12:24, w=Math.min(compact?142:230,cw*.36);
  const x=margin,right=cw-margin,upper=top+6,base=ch-(isTouch?116:27);
  g.save();g.shadowColor='#071018';g.shadowBlur=3;
  hudStrip(g,x,upper,w,28,flightUI.ink);
  hudStrip(g,x,upper,compact?52:65,28,'#d88a29');
  hudText(g,'ST '+String(stage).padStart(2,'0'),x+9,upper+14,compact?13:16,'#0d1722','left',true);
  hudText(g,curTheme.name,x+(compact?55:69),upper+15,compact?9:13,'#f3f7ed','left',true);
  cellMeter(g,x+3,upper+31,w-6,3,24,Math.min(1,stageDist/STAGE_LEN),flightUI.gold);
  if(!compact&&ch>400)tacticalRadar(g,x+31,upper+78,28);
  hudStrip(g,right-w,upper,w,40,flightUI.ink);
  hudText(g,'SCORE',right-w+12,upper+12,9,flightUI.gold);
  drawArcadeScore(g,score,right-10,upper+25,compact?3:4);
  if(combo>=2)hudText(g,combo+'  HIT',right-3,upper+60,23,flightUI.gold,'right',true);
  const side=Math.min(compact?114:196,cw*.32),panelHeight=44;
  const speedBase=base-24;
  hudStrip(g,x,speedBase-panelHeight,side,panelHeight,flightUI.ink);
  hudText(g,'SPEED',x+12,speedBase-32,9,flightUI.mint);
  hudText(g,Math.round(speed*6),x+10,speedBase-13,compact?21:27,'white','left',true);
  if(!compact)hudText(g,'M '+(speed*6/soundBarrier.speedKmh).toFixed(2),x+side-12,speedBase-32,10,flightUI.cyan,'right');
  if(!compact)hudText(g,'ALT  '+Math.round(P.y*10),x+side-12,speedBase-17,11,'#c2d6db','right');
  drawHullGauge(g,x,base,side,compact);
  hudStrip(g,right-side,base-panelHeight,side,panelHeight,flightUI.ink);
  hudText(g,'MISSILE',right-side+12,base-32,9,flightUI.gold);
  hudText(g,String(P.msl).padStart(2,'0'),right-13,base-20,compact?24:30,'#fff6ce','right',true);
  hudText(g,lockHeld?'LOCK ×'+locks.length:lockFA?'SALVO':'READY',right-side+12,base-14,compact?9:12,lockHeld?flightUI.red:flightUI.mint);
  cellMeter(g,right-side+3,base+3,side-6,5,Math.min(18,lockCap()),Math.min(1,P.msl/lockCap()),flightUI.gold);
  hudText(g,GUN[P.gunLv].name+'  /  LV '+P.lv,right-2,base+16,9,'#d0e8ef','right');
  const width=Math.min(compact?126:256,cw-2*(side+margin+8)),center=cw*.5;
  const y=compact?base-54:base-14;
  hudStrip(g,center-width/2-4,y-13,width+8,37,flightUI.ink);
  const active=rush.focus>0, readiness=active?rush.focus/2.5:1-rush.cool/12;
  const label=active?'RUSH  /  FOCUS':rush.cool>0?'RUSH   '+Math.ceil(rush.cool)+'s':isTouch?'RUSH READY':'RUSH READY   [F]';
  hudText(g,label,center,y,compact?11:15,active?'#f9f4c7':flightUI.gold,'center',true);
  cellMeter(g,center-width/2+5,y+11,width-10,6,16,readiness,active?flightUI.cyan:flightUI.gold);
  const host=bossState==='fight'&&boss?.alive?boss:midE?.alive?midE:null;
  if(bossState==='fight'&&bossRoster.length>1){
    drawBossFormationHUD(g,upper,margin,w);
  }else if(host){const name=host===boss?bossDef.name:host.mdef.name,by=compact?upper+58:upper+17,bw=Math.min(235,cw*.49);
    hudText(g,name,center,by,13,flightUI.gold,'center',true);
    cellMeter(g,center-bw/2,by+11,bw,5,24,host.hp/host.maxhp,flightUI.red);
    weakPips(g,host,center,by+28);}
  if(soundBarrier.elapsed<.85){
    g.globalAlpha=Math.min(1,(.85-soundBarrier.elapsed)*4);
    hudText(g,'MACH 1',center,ch*.27,compact?20:30,'#dcfaff','center',true);
  }
  g.restore();
}
function arcadeSight(g){
  tA.copy(ppos).addScaledVector(pfwd,250);toS(tA,scr);
  if(!scr.front)return;
  const x=scr.x,y=scr.y,active=rush.focus>0,scale=Math.min(1,cw/650);
  const w=(active?80:lockHeld?54:32)*(.7+.3*scale),h=w*.67;
  const col=locks.length?flightUI.gold:active?flightUI.cyan:flightUI.mint;
  g.save();g.translate(x,y);g.shadowColor='#132824';g.shadowBlur=2;
  g.strokeStyle=col;g.lineWidth=2.2;
  for(const sx of [-1,1])for(const sy of [-1,1]){
    g.beginPath();g.moveTo(sx*(w-10),sy*h);g.lineTo(sx*(w-3),sy*h);g.lineTo(sx*w,sy*(h-3));g.lineTo(sx*w,sy*(h-9));g.stroke();}
  g.lineWidth=1.5;ln(g,-8,0,-3,0);ln(g,3,0,8,0);ln(g,0,-6,0,-2);
  if(lockHeld||active)hudText(g,locks.length?'LOCK ×'+locks.length:'SCAN',0,h+13,10,col,'center');
  g.restore();
}

function drawHUD(rdt){
  const g=hx;g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,cw,ch);const cx=cw/2,cy=ch/2,top=safeT+10;
  document.body.classList.toggle('flight-hints',state==='play'&&stageDist<540);if(state==='play')drawDirAlert(g,cx,cy,top,rdt);if(lockFA){lockFA.t+=rdt;if(lockFA.t>lockFA.n*0.022*lockFA.sv+0.25+0.4)lockFA=null}if(mslN&&mslN._v!==P.msl){mslN._v=P.msl;mslN.textContent=P.msl}
  if(state==='play'||state==='clear'||state==='over'||state==='crash'){
    const inten=clamp((speed-100)/120,0.15,1)*(burnT>0?.7:.12),R0=Math.hypot(cw,ch)*0.5;g.lineCap='round';
    for(const L of lines){if(!paused){L.r+=rdt*(0.9+speed/90)*(burnT>0?2.2:1);if(L.r>1){L.r=Math.random()*0.15;L.a=Math.random()*6.283}}
      const r1=R0*(0.28+L.r*0.85),r2=r1+R0*(0.06+0.22*L.r*inten);g.strokeStyle=`rgba(255,255,255,${(0.012+0.17*inten)*L.r})`;g.lineWidth=L.w*(1+L.r*2);ln(g,cx+Math.cos(L.a)*r1,cy+Math.sin(L.a)*r1,cx+Math.cos(L.a)*r2,cy+Math.sin(L.a)*r2)}
    g.lineCap='butt';
  }
  if(cloudWhite>0.02){g.fillStyle=`rgba(255,255,255,${cloudWhite*0.95})`;g.fillRect(0,0,cw,ch)}
  if(!(state==='play'||state==='clear'||state==='over'||state==='crash'))return;
  g.lineWidth=1.5;g.strokeStyle=G;g.fillStyle=G;g.textAlign='center';g.textBaseline='middle';g.shadowColor='rgba(0,0,0,.8)';g.shadowBlur=3;g.font='600 10px ui-monospace,monospace';
  arcadeSight(g);
  const lockCnt=new Map(),lockIdx=new Map();locks.forEach((e,i)=>{lockCnt.set(e,(lockCnt.get(e)||0)+1);lockIdx.set(e,i+1)});let arrows=0;
  for(const e of enemies){if(e.hidden)continue;const d=e.pos.distanceTo(ppos);if(d>1000)continue;toS(e.pos,scr);const L=lockCnt.get(e)||0;
    if(!scr.front||scr.x<0||scr.x>cw||scr.y<0||scr.y>ch){if(d<380&&!e.ground&&(e.isBoss||(e.type!=='drone'&&arrows++<6))){const a=Math.atan2(scr.ly,scr.lx);arrow(g,cx,cy,a,Math.min(cw,ch)*0.42,e.isBoss?RED:'rgba(255,140,110,.9)',e.isBoss?12:8)}continue}
    if(e.isPart){const s2=clamp(e.r*260/Math.max(d,20),6,20),pl=0.5+0.5*Math.sin(time*8);g.strokeStyle=L?RED:'#ffe36a';g.lineWidth=L?2.4:1.6;g.beginPath();g.moveTo(scr.x,scr.y-s2-3);g.lineTo(scr.x+s2+3,scr.y);g.lineTo(scr.x,scr.y+s2+3);g.lineTo(scr.x-s2-3,scr.y);g.closePath();g.stroke();
      g.fillStyle='#ffe36a';g.font='800 8px ui-monospace,monospace';g.textAlign='center';if(pl>0.3)g.fillText('WEAK',scr.x,scr.y-s2-6);g.fillStyle='rgba(0,0,0,.5)';g.fillRect(scr.x-s2,scr.y+s2+5,s2*2,2);g.fillStyle='#ffe36a';g.fillRect(scr.x-s2,scr.y+s2+5,s2*2*Math.max(0,e.hp)/e.maxhp,2);
      if(L>1){g.fillStyle=RED;g.font='900 10px ui-monospace,monospace';g.fillText('×'+L,scr.x+s2+12,scr.y-s2)}g.fillStyle=G;g.strokeStyle=G;g.lineWidth=1.2;continue}
    if((e.fl||e.runner)&&Math.floor(time*6)%2){g.fillStyle='#ffb040';g.font='800 8px ui-monospace,monospace';g.textAlign='center';g.fillText(e.runner?'RUNNER':'FLEE',scr.x,scr.y-16)}
    if(!L&&!e.isBoss&&!e.isMid&&(d>520||(e.ground&&d>260)))continue;const s=clamp(e.r*280/Math.max(d,20),8,e.isBoss?80:34);g.strokeStyle=L?'#ff6439':'rgba(171,255,193,.72)';g.lineWidth=L?2.2:1.2;
    if(e.ground){g.beginPath();g.moveTo(scr.x,scr.y-s);g.lineTo(scr.x+s,scr.y);g.lineTo(scr.x,scr.y+s);g.lineTo(scr.x-s,scr.y);g.closePath();g.stroke()}
    else{const c=s*0.45;for(const[a,b]of[[-1,-1],[1,-1],[1,1],[-1,1]]){g.beginPath();g.moveTo(scr.x+a*s,scr.y+b*(s-c));g.lineTo(scr.x+a*s,scr.y+b*s);g.lineTo(scr.x+a*(s-c),scr.y+b*s);g.stroke()}}
    if(L){g.save();g.translate(scr.x,scr.y);g.rotate(Math.PI*.25);g.strokeRect(-s-4,-s-4,(s+4)*2,(s+4)*2);g.restore();if(L>1){g.fillStyle=RED;g.font='900 11px ui-monospace,monospace';g.fillText('×'+L,scr.x+s+12,scr.y-s);g.fillStyle=G}}
    if(e.hp<e.maxhp&&!e.isBoss&&e.maxhp>3){g.fillStyle='rgba(0,0,0,.5)';g.fillRect(scr.x-s,scr.y+s+3,s*2,3);g.fillStyle=RED;g.fillRect(scr.x-s,scr.y+s+3,s*2*e.hp/e.maxhp,3);g.fillStyle=G}}
  for(const m of emsl){toS(m.pos,scr);if(!scr.front||scr.x<0||scr.x>cw||scr.y<0||scr.y>ch)arrow(g,cx,cy,Math.atan2(scr.ly,scr.lx),Math.min(cw,ch)*0.34,RED,11)}
  g.strokeStyle=G;g.lineWidth=1.5;
  for(const b of bolts){const sp=b.pts.map(p=>toS(p,{}));g.lineJoin='round';
    for(const pass of[[7,'rgba(110,200,255,.35)'],[2.4,'rgba(235,250,255,.95)']]){g.lineWidth=pass[0];g.strokeStyle=pass[1];g.beginPath();
      for(let i=0;i<sp.length-1;i++){const a=sp[i],c=sp[i+1];if(!a.front||!c.front)continue;if(i===0)g.moveTo(a.x,a.y);const n=7,dx=c.x-a.x,dy=c.y-a.y,ln_=Math.hypot(dx,dy)||1;
        for(let k=1;k<=n;k++){const f=k/n,j=k<n?(Math.random()-.5)*Math.min(26,ln_*0.12):0;g.lineTo(a.x+dx*f-dy/ln_*j,a.y+dy*f+dx/ln_*j)}}g.stroke()}}
  g.lineWidth=1.5;g.strokeStyle=G;
  g.font='900 12px ui-monospace,monospace';for(const p of pops){toS(p.p,scr);if(!scr.front)continue;g.globalAlpha=1-p.t/0.9;g.fillStyle=p.c;g.fillText(p.s,scr.x,scr.y-12-p.t*30)}g.globalAlpha=1;
  drawFlightDeck(g,top);
  g.fillStyle=G;g.textAlign='center';
  if(bossState==='warn'&&Math.floor(time*4)%2===0){g.fillStyle='rgba(255,40,40,.25)';g.fillRect(0,cy-34,cw,68);g.fillStyle=RED;g.font='900 26px ui-monospace,monospace';g.fillText('WARNING!!',cx,cy-8);g.font='800 12px ui-monospace,monospace';const incoming=encounterBossDefs().length;g.fillText(incoming>1?'BOSS FORMATION  ×'+incoming:'HUGE ENEMY APPROACHING',cx,cy+16)}
  if(emsl.length&&Math.floor(time*6)%2===0){g.fillStyle=RED;g.font='900 15px ui-monospace,monospace';g.fillText('MISSILE ALERT',cx,cy+Math.min(130,ch*0.17))}
  let my=cy-Math.min(125,ch*0.19);for(const m of msgs.filter(m=>!m.t.startsWith('NEW ENEMY')&&!m.t.startsWith('STAGE ')&&!m.t.startsWith(curTheme.name)).slice(-2)){g.globalAlpha=clamp((m.dur-m.a)*2,0,1);g.fillStyle=m.c;g.font=(m.big?'900 20px':'800 13px')+' ui-monospace,monospace';g.fillText(m.t,cx,my);my+=m.big?26:18}
  g.globalAlpha=1;g.shadowBlur=0;
  if(timeScale<0.8){g.strokeStyle=`rgba(255,220,120,${(1-timeScale)*0.5})`;g.lineWidth=6;g.strokeRect(3,3,cw-6,ch-6);g.lineWidth=1.5}
  if(stick.on){g.strokeStyle='rgba(182,255,196,.55)';g.beginPath();g.arc(stick.ox,stick.oy,55,0,7);g.stroke();g.fillStyle='rgba(182,255,196,.35)';g.beginPath();g.arc(stick.ox+stick.x*55,stick.oy+stick.y*55,20,0,7);g.fill()}
  if(omegaFlash>0){g.fillStyle=`rgba(255,240,210,${omegaFlash*0.8})`;g.fillRect(0,0,cw,ch)}
  if(zoneHUD){const Z=zoneHUD,yy=cy+Math.min(150,ch*0.2);g.textAlign='center';
    if(Z.danger){if(Math.floor(time*8)%2===0){g.fillStyle='#ff4a3a';g.font='900 15px ui-monospace,monospace';g.fillText(Z.z.kind==='field'?'⚠ 쉴드 돔으로 피신하라 ⚠':'⚠ 장판 밖으로 이동 ⚠',cx,yy)}
      g.fillStyle='#ffd0c8';g.font='800 11px ui-monospace,monospace';g.fillText(Z.left.toFixed(1)+'s',cx,yy+16)}
    else{g.fillStyle='#7affd8';g.font='900 13px ui-monospace,monospace';g.fillText('SAFE',cx,yy)}
    const z=Z.z;if(Z.danger&&z.kind!=='field'){const w=z.kind==='disc'?z.r:z.w/2,L=z.x-w-6,Rr=z.x+w+6,tx=(L<-XB?Rr:Rr>XB?L:(Math.abs(P.x-L)<Math.abs(P.x-Rr)?L:Rr));const dir=Math.sign(tx-P.x);
      g.fillStyle='#ffe36a';g.font='900 22px ui-monospace,monospace';g.fillText(dir<0?'◀◀':'▶▶',cx+dir*70,yy-2)}
    if(z.domes)for(const d of z.domes){tA.set(d.sf.x,zGround()+d.sf.r+6,scrollZ-20);toS(tA,scr);if(!scr.front)continue;const px=clamp(scr.x,20,cw-20),py=clamp(scr.y,60,ch-80);
      g.strokeStyle='#7affd8';g.lineWidth=2;g.beginPath();g.arc(px,py,10+3*Math.sin(time*10),0,6.28);g.stroke();g.fillStyle='#7affd8';g.font='900 11px ui-monospace,monospace';g.fillText('SHELTER ▼',px,py-16);
      if(Z.danger){g.globalAlpha=0.5;g.beginPath();g.moveTo(cx,cy);g.lineTo(px,py);g.stroke();g.globalAlpha=1}}}
  if(hitFlash>0){const gr=g.createRadialGradient(cx,cy,Math.min(cw,ch)*0.3,cx,cy,Math.max(cw,ch)*0.75);gr.addColorStop(0,'rgba(255,40,30,0)');gr.addColorStop(1,`rgba(255,40,30,${hitFlash*0.5})`);g.fillStyle=gr;g.fillRect(0,0,cw,ch)}
}

/* =====================================================================
   오프닝 컷신 — 격납고 브리핑 → 게이트 개방 → 엔진 점화 → 출격
   ===================================================================== */
const IN={built:false,t:0,done:false};
function ibox(w,h,d,col,x,y,z,parent){const g=new THREE.BoxGeometry(w,h,d),c=new THREE.Color(col),fs=[0.8,0.8,1,0.5,0.9,0.66],cols=[];
  for(let f=0;f<6;f++)for(let i=0;i<4;i++)cols.push(c.r*fs[f],c.g*fs[f],c.b*fs[f]);g.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));
  const m=new THREE.Mesh(g,IN.mat);m.position.set(x,y,z);(parent||IN.scene).add(m);return m}
function iglow(w,h,d,col,x,y,z,parent){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshBasicMaterial({color:col}));m.position.set(x,y,z);(parent||IN.scene).add(m);return m}
function cvTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;return t}
function holoDraw(g,mode,mouth,flick){
  g.clearRect(0,0,96,72);g.fillStyle='rgba(20,60,140,.55)';g.fillRect(0,0,96,72);
  const C='#7fd0ff',D='#2a6ac8',L='#c8f0ff';
  if(mode==='op'){
    g.fillStyle=D;g.fillRect(14,58,40,14);g.fillStyle=C;g.fillRect(16,58,36,3);g.fillRect(30,60,8,12);        // 제복·칼라
    g.fillStyle=D;g.fillRect(28,48,12,10);                                                                 // 목
    g.fillStyle=C;g.fillRect(22,22,24,28);g.fillStyle=L;g.fillRect(24,26,20,20);                            // 얼굴
    g.fillStyle=D;g.fillRect(19,14,30,12);g.fillRect(19,14,6,30);g.fillRect(43,14,6,24);g.fillRect(24,24,10,4);// 단발 앞머리
    g.fillStyle='#0a2a6a';g.fillRect(27,32,5,3);g.fillRect(37,32,5,3);g.fillStyle='#fff';g.fillRect(28,32,1,1);g.fillRect(38,32,1,1); // 눈
    g.fillStyle=D;g.fillRect(31+0,42,6,mouth?3:1);                                                          // 입
    g.fillStyle=C;g.fillRect(17,30,3,9);g.fillRect(17,39,10,2);g.fillRect(26,38,3,3);                       // 헤드셋 마이크
    g.fillStyle=C;g.fillRect(62,10,22,3);g.fillRect(66,13,14,2);g.fillRect(70,15,6,6);g.fillRect(60,8,4,2);g.fillRect(82,8,4,2); // 날개 엠블럼
    for(let i=0;i<6;i++){g.fillStyle=i%2?D:C;g.fillRect(62,26+i*5,(i*7%5)+12,2)}
  }else if(mode==='maint'){
    g.fillStyle=L;g.font='bold 9px monospace';g.textAlign='left';g.textBaseline='top';g.fillText('SYSTEM CHECK',8,6);
    const rows=['ENGINE','AVIONICS','WEAPONS','ARMOR'];rows.forEach((r,i)=>{g.fillStyle=C;g.fillText(r,8,22+i*11);g.fillStyle=D;g.fillRect(52,24+i*11,36,6);g.fillStyle=L;g.fillRect(52,24+i*11,36*Math.min(1,((flick/30)*0.6+i*0.1)%1.2),6)});
  }else if(mode==='luck'){
    g.fillStyle=L;g.font='bold 13px monospace';g.textAlign='center';g.textBaseline='middle';g.fillText('GOOD LUCK!',48,34);
    g.fillStyle=C;g.fillRect(18,48,60,1);
  }
  g.fillStyle='rgba(0,10,40,.35)';for(let y=(flick|0)%2;y<72;y+=2)g.fillRect(0,y,96,1);
}
/* 오프닝 전용 기체: 빨강·흰색, 대구경 쌍발 원형 노즐, 쌍수직미익 (기수 -z) */
const IJ_RANGE=[-14,14,0,13,-22,16];
function introJetShape(x,y,z){
  const ax=Math.abs(x),f=-z,W=[.93,.93,.9],RD=[.84,.18,.15],GR=[.56,.6,.66],DK=[.16,.16,.19],GL=glow([.45,.9,1]);
  const nac=Math.hypot(ax-4,y-4);
  if(f>=-15&&f<=-14&&nac<=2.7)return nac<=1.7?[.1,.07,.07]:(nac>2.2?GR:DK);              // 노즐(내부는 어둡게, 발광은 별도 메시)
  if(f>=-13&&f<=1&&nac<=2.6)return(f%5===0)?W:(nac>1.9?RD:[.7,.14,.12]);                  // 엔진 나셀
  if(f>=2&&f<=5&&nac<=2.2&&ax>=3)return f===5?DK:W;                                       // 흡입구
  const bw=f>12?Math.max(0,2-(f-12)*0.35):2;
  if(f>=-12&&f<=19&&ax<=bw+0.2&&y>=3&&y<=6-(f>14?(f-14)*0.5:0)){if(f>=17)return f===19?RD:W;return(f>=8&&f<=10)?RD:W}
  if(y===7&&ax<=1&&f>=5&&f<=10)return GL;if(y===7&&ax<=1&&f===4)return DK;
  if(y===4&&f>=-11&&f<=4){const hs=7+(4-f)*0.55;if(ax>=2&&ax<=Math.min(14,hs))return ax>=Math.min(14,hs)-1.2?RD:W}
  if(y===4&&f>=-16&&f<=-12&&ax>=6&&ax<=10)return ax>=9?RD:W;
  for(const s of[-1,1]){const fx=s*(5+Math.max(0,y-7)*0.35);if(y>=7&&y<=13&&Math.abs(x-fx)<=0.6&&f>=-14+(y-7)*0.5&&f<=-9+(y-7)*0.3)return y>=12?RD:W}
  return null;
}
function v2w(range,s,vx,vy,vz,centerY=false){const[x0,x1,y0,y1,z0,z1]=range;const cx=(x0+x1+1)/2,cy=centerY?(y0+y1+1)/2:y0,cz=(z0+z1+1)/2;return new V3((vx+0.5-cx)*s,(vy+0.5-cy)*s,(vz+0.5-cz)*s)}
function buildIntro(){
  IN.scene=new THREE.Scene();IN.scene.background=new THREE.Color(0x0a0e1c);IN.scene.fog=new THREE.Fog(0x0a0e1c,110,300);
  IN.cam=new THREE.PerspectiveCamera(55,1,0.5,800);IN.mat=new THREE.MeshBasicMaterial({vertexColors:true});
  const S=IN.scene;
  const skyT=()=>cvTex(128,64,(g)=>{const gr=g.createLinearGradient(0,0,0,64);gr.addColorStop(0,'#1f6fd8');gr.addColorStop(0.55,'#7fc0f4');gr.addColorStop(1,'#d8eeff');g.fillStyle=gr;g.fillRect(0,0,128,64);
    for(let i=0;i<70;i++){const x=Math.random()*128,y=32+Math.random()*32,r=2+Math.random()*6;g.fillStyle='#b8d4ee';g.beginPath();g.arc(x+1,y+1.5,r,0,7);g.fill();g.fillStyle='#fff';g.beginPath();g.arc(x,y,r,0,7);g.fill()}
    g.fillStyle='rgba(255,255,255,.7)';for(let i=0;i<8;i++)g.fillRect(Math.random()*128|0,8+Math.random()*16|0,6+Math.random()*10|0,1)});
  // 바닥
  const ft=cvTex(32,32,(g)=>{g.fillStyle='#3a4458';g.fillRect(0,0,32,32);g.fillStyle='#2c3446';g.fillRect(0,0,32,1);g.fillRect(0,0,1,32);g.fillStyle='#4a5670';g.fillRect(2,2,1,1);g.fillRect(29,29,1,1)});
  ft.wrapS=ft.wrapT=THREE.RepeatWrapping;ft.repeat.set(30,40);
  const fl=new THREE.Mesh(new THREE.PlaneGeometry(120,260),new THREE.MeshBasicMaterial({map:ft}));fl.rotation.x=-Math.PI/2;fl.position.z=-60;S.add(fl);
  for(let z=14;z>-175;z-=8)iglow(0.6,0.05,4,0xe0c040,0,0.03,z);
  for(const x of[-13,13])for(let z=20;z>-175;z-=4)iglow(1.2,0.05,2,(Math.round(z/4)%2)?0xe0c040:0x161616,x,0.03,z);
  // 측벽: 왼쪽 벽에 큰 창(구름 하늘), 리브·조명·배관
  const win=new THREE.Mesh(new THREE.PlaneGeometry(70,26),new THREE.MeshBasicMaterial({map:skyT(),fog:false}));win.rotation.y=Math.PI/2;win.position.set(-59,22,-45);S.add(win);
  for(const sd of[-1,1]){
    if(sd<0){ibox(2,9,260,0x1c2438,-58,4.5,-60);ibox(2,5,260,0x1c2438,-58,37.5,-60);ibox(2,26,30,0x1c2438,-58,22,10);ibox(2,26,110,0x1c2438,-58,22,-135)}else ibox(2,40,260,0x1c2438,58,20,-60);
    for(let z=20;z>-180;z-=14){ibox(3,40,2,0x2a3550,sd*56,20,z);iglow(0.6,8,0.6,0x9ad8ff,sd*55,32,z);ibox(5,2,6,0x3a4560,sd*53,6,z-6);ibox(1.2,1.2,14,0x55607a,sd*54,14,z-7)}}
  for(let z=20;z>-180;z-=14){ibox(116,2,2,0x222a40,0,40,z);iglow(10,0.5,1,0xcfeaff,0,38.8,z-7)}
  // 발진 받침대·정비 장비
  ibox(6,1.2,36,0x2a2f3a,0,0.6,0);for(let z=-14;z<=16;z+=6)ibox(8,0.5,1,0xe0a020,0,1.25,z);
  ibox(3,18,3,0x3a4258,-17,9,4);ibox(10,2,2,0x4a546c,-12.5,15,4);ibox(2,4,2,0xd06020,-8,13,4);iglow(1,1,1,0xff4030,-17,18.6,4);
  ibox(4,6,4,0x404a60,-24,3,-10);ibox(4,4,4,0x505a70,-24,8,-10);ibox(2.4,1.6,1.6,0x6a7488,-20,10,-10);
  ibox(1.2,9,1.2,0x8a8f9a,6.5,4.5,-6);for(let y=1;y<9;y+=1.5)ibox(2.4,0.3,0.6,0x8a8f9a,6.5,y,-6);   // 탑승 사다리
  for(let i=0;i<5;i++)ibox(3,3,3,i%2?0x6a5a3a:0x55603a,-30-(i%2)*3.2,1.5+(i>2?3:0),-18+i*2);
  // 출격 게이트 + 그 너머 하늘
  const sk=new THREE.Mesh(new THREE.PlaneGeometry(420,210),new THREE.MeshBasicMaterial({map:skyT(),fog:false}));sk.position.set(0,50,-240);S.add(sk);
  ibox(120,8,4,0x1a2034,0,40,-92);
  IN.doorL=new THREE.Group();IN.doorR=new THREE.Group();S.add(IN.doorL,IN.doorR);
  for(const[d,sd]of[[IN.doorL,-1],[IN.doorR,1]]){ibox(40,36,3,0x253050,sd*20,18,-92,d);for(let y=4;y<36;y+=8)ibox(40,0.8,0.6,0x323e60,sd*20,y,-90.3,d);
    for(let x=4;x<40;x+=9)ibox(0.8,36,0.6,0x2c3858,sd*x,18,-90.2,d);for(let i=0;i<8;i++)ibox(2.2,1,0.6,i%2?0xe0c040:0x161616,sd*(2+i*2.3),1.5,-90.1,d)}
  // 홀로그램
  IN.holoCv=document.createElement('canvas');IN.holoCv.width=96;IN.holoCv.height=72;IN.holoTex=new THREE.CanvasTexture(IN.holoCv);IN.holoTex.magFilter=IN.holoTex.minFilter=THREE.NearestFilter;IN.holoTex.generateMipmaps=false;
  IN.holo=new THREE.Mesh(new THREE.PlaneGeometry(34,25.5),new THREE.MeshBasicMaterial({map:IN.holoTex,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));IN.holo.position.set(0,21,-89.5);S.add(IN.holo);
  // 기체 (오프닝 전용 모델)
  const JS=1.15;IN.jet=new THREE.Group();const hangarJet=newJet();hangarJet.scale.setScalar(JS/.42);hangarJet.position.y=5.4;IN.jet.add(hangarJet);lightRig(S);IN.jet.position.set(0,1.2,0);S.add(IN.jet);
  IN.noz=[];IN.flame=[];IN.core=[];
  for(const sd of[-1,1]){const p=v2w(IJ_RANGE,JS,sd*4,4,15);
    const n=new THREE.Mesh(new THREE.CircleGeometry(1.75*JS,10),new THREE.MeshBasicMaterial({color:0x220806}));n.position.set(p.x,p.y,p.z+0.6);IN.jet.add(n);IN.noz.push(n);
    const c=new THREE.Mesh(new THREE.CircleGeometry(1.0*JS,8),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0,blending:THREE.AdditiveBlending}));c.position.set(p.x,p.y,p.z+0.7);IN.jet.add(c);IN.core.push(c);
    const f=new THREE.Mesh(new THREE.ConeGeometry(1.7*JS,1,8,1,true),new THREE.MeshBasicMaterial({color:0xbfe8ff,transparent:true,opacity:0.92,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    f.rotation.x=-Math.PI/2;f.position.set(p.x,p.y,p.z+0.7);f.visible=false;IN.jet.add(f);IN.flame.push({m:f,z:p.z+0.7})}
  IN.tailZ=v2w(IJ_RANGE,JS,0,4,15).z;IN.cockpit=v2w(IJ_RANGE,JS,0,7,-7);
  // 파일럿
  IN.pilot=new THREE.Group();const W=0xf0f0ec,RD=0xd23a2a;
  ibox(0.5,1.4,0.5,W,-0.3,0.7,0,IN.pilot);ibox(0.5,1.4,0.5,W,0.3,0.7,0,IN.pilot);ibox(1.3,1.5,0.8,W,0,2.1,0,IN.pilot);ibox(1.3,0.4,0.82,RD,0,2.5,0,IN.pilot);
  ibox(0.35,1.3,0.4,W,-0.85,2.1,0,IN.pilot);ibox(0.35,1.3,0.4,W,0.85,2.1,0,IN.pilot);ibox(0.9,0.9,0.9,RD,0,3.3,0,IN.pilot);ibox(0.7,0.35,0.1,0x223050,0,3.35,0.46,IN.pilot);
  S.add(IN.pilot);
  // 원테이크 카메라 경로 (시간, 위치, 시선) — 컷 없이 한 번에
  const K=(t,p,l)=>({t,p:new V3(...p),l:new V3(...l)});
  IN.keysL=[K(0,[52,12,32],[-14,8,-40]),K(4.4,[50,12,28],[-12,9,-42]),K(6.3,[34,8,26],[0,9,-34]),K(7.6,[11,6,33],[0,5,0]),K(8.6,[0,5.6,35],[0,4.6,10]),K(9.7,[0,5.3,33],[0,4.6,6]),K(10.7,[0,8.5,40],[0,7,-90]),K(12.2,[0,10,16],[0,12,-170])];
  IN.keysP=[K(0,[14,9,48],[-4,10,-92]),K(4.4,[13,9,46],[-4,10,-92]),K(6.3,[22,8,32],[0,9,-40]),K(7.6,[9,6,36],[0,5,0]),K(8.6,[0,5.8,46],[0,4.6,10]),K(9.7,[0,5.5,44],[0,4.6,6]),K(10.7,[0,8.5,50],[0,7,-90]),K(12.2,[0,10,20],[0,12,-170])];
  const mk=keys=>({pos:new THREE.CatmullRomCurve3(keys.map(k=>k.p),false,'centripetal'),look:new THREE.CatmullRomCurve3(keys.map(k=>k.l),false,'centripetal'),ts:keys.map(k=>k.t)});
  IN.pathL=mk(IN.keysL);IN.pathP=mk(IN.keysP);
  IN.built=true;
}
const SUBS=[[0.3,'CONTROL','전 활주로 클리어. 발진 시퀀스를 개시합니다.'],[2.4,'CONTROL','GOOD LUCK, 파일럿.'],[4.3,'SYSTEM','HANGAR GATE — OPEN'],[8.3,'SYSTEM','ENGINE IGNITION'],[9.9,'','PIXEL ALESTE, LAUNCH!']];
const INTRO_END=12.2;
let introFlash=0,introSub=null,introSubT=0,introBlip=0;
for(const ev of['pointerdown','keydown','pointermove','wheel'])addEventListener(ev,()=>{idleT=0},{passive:true});
function startIntro(mode='opening'){
  ov.classList.remove('deck');
  if(!IN.built)buildIntro();
  IN.mode=mode;IN.t0=mode==='launch'?7.0:0;IN.t=IN.t0;IN.done=false;IN.stage={};introFlash=0;introSub=null;
  if(mode==='launch'){introSub=[7.0,'CONTROL','MISSION '+stage+' — '+curTheme.name+'. 발진을 허가한다.'];introSubT=0}
  IN.doorL.position.x=0;IN.doorR.position.x=0;IN.jet.position.set(0,1.2,0);IN.jet.rotation.set(0,0,0);IN.pilot.position.set(9,0,-2);IN.pilot.rotation.y=-0.9;IN.pilot.visible=true;
  for(const f of IN.flame)f.m.visible=false;for(const n of IN.noz)n.material.color.setHex(0x220806);for(const c of IN.core)c.material.opacity=0;
  state='intro';ov.classList.add('hide');bPause.style.display='none';document.body.classList.add('cine');
  playSong(mode==='launch'?'stage':'story');
}
function finishIntro(){
  if(state!=='intro')return;IN.done=true;document.body.classList.remove('cine');cloudWhite=1;hitFlash=0;pMesh.visible=true;P.alive=true;
  if(IN.mode==='launch'){state='play';ov.classList.add('hide');bPause.style.display='block';P.inv=2;playSong('stage',curTheme.tr)}else{showTitle();playSong('opening')}
}
function once(k,fn){if(!IN.stage[k]){IN.stage[k]=1;fn()}}
function camAt(path,t,C){const ts=path.ts,n=ts.length;let i=0;while(i<n-2&&t>ts[i+1])i++;const k=clamp((t-ts[i])/(ts[i+1]-ts[i]),0,1);const u=(i+k)/(n-1);
  C.position.copy(path.pos.getPoint(u));C.lookAt(path.look.getPoint(u))}
function updIntro(dt){
  const t=(IN.t+=dt),C=IN.cam;C.aspect=cw/ch;const port=cw<ch;
  for(const s of SUBS)if(s[0]>=IN.t0&&t>=s[0]&&introSub!==s){introSub=s;introSubT=0}
  if(introSub){introSubT+=dt;introBlip-=dt;const n=Math.floor(introSubT*28);if(n<=introSub[2].length&&introBlip<=0&&AU.ctx&&AU.on){introBlip=0.05;pulse(AU.ctx.currentTime,1300+Math.random()*300,0.03,0.035,.25,AU.sfx)}}
  // 홀로그램: 오퍼레이터 → GOOD LUCK! → 꺼짐
  const hg=IN.holoCv.getContext('2d');const mode=t<2.4?'op':t<3.9?'luck':'off';let op=mode==='off'?0:1;
  if(t<0.4)op=t/0.4;if(t>3.75&&t<3.95)op=Math.random()<0.5?0.2:1;if(t>2.3&&t<2.45)op=Math.random()<0.5?0.3:1;
  if(mode!=='off'){holoDraw(hg,mode,Math.floor(t*8)%2===0&&t<2.2,t*30);IN.holoTex.needsUpdate=true}
  IN.holo.material.opacity=op*(0.85+Math.random()*0.15);IN.holo.visible=op>0.01;
  // 게이트 개방
  if(t>4.2){const k=clamp((t-4.2)/2.8,0,1),e=k<0.15?k*0.25:0.0375+(k-0.15)*1.13;IN.doorL.position.x=-e*40;IN.doorR.position.x=e*40;
    once('door',()=>{if(AU.ctx&&AU.on){nz(AU.ctx.currentTime,2.8,0.25,'lowpass',260,120,AU.sfx);pulse(AU.ctx.currentTime,90,0.25,0.08,.5,AU.sfx,60)}})}
  // 파일럿: 사다리로 걸어가 콕핏 탑승
  if(t>4.4){const k=clamp((t-4.4)/2.4,0,1),cp=IN.cockpit;
    if(k<0.35){const u=k/0.35;IN.pilot.position.set(lerp(9,7.6,u),0,lerp(-2,-6,u));IN.pilot.rotation.y=-2.4}
    else if(k<0.75){const u=(k-0.35)/0.4;IN.pilot.position.set(7.4,u*8.4,-6);IN.pilot.rotation.y=-Math.PI/2}
    else{const u=(k-0.75)/0.25;IN.pilot.position.set(lerp(7.4,cp.x,u),lerp(8.4,cp.y+1.2-u*3,u),lerp(-6,cp.z,u))}
    IN.pilot.visible=k<0.97}
  // 엔진 스풀업 → 점화
  if(t>8.0){once('spool',()=>{if(AU.ctx&&AU.on){const a=AU.ctx.currentTime;pulse(a,70,1.3,0.09,.5,AU.sfx,520);nz(a,1.4,0.2,'bandpass',300,2400,AU.sfx)}});
    const k=clamp((t-8.0)/1.25,0,1),col=new THREE.Color().setRGB(0.18+0.82*k,0.05+0.65*k*k,0.03+0.6*k*k*k);for(const n of IN.noz)n.material.color.copy(col);
    for(const c of IN.core){c.material.opacity=k*0.9;c.material.color.setRGB(1,0.8*k,0.6*k)}}
  if(t>9.25){once('ign',()=>{introFlash=0.85;if(AU.ctx&&AU.on){const a=AU.ctx.currentTime;nz(a,1.3,0.45,'lowpass',3200,400,AU.sfx);tri(a,110,0.6,0.3,AU.sfx,40)}});
    const lv=t<9.9?5:10;for(const f of IN.flame){f.m.visible=true;const L=lv+Math.random()*3;f.m.scale.set(1+Math.random()*0.12,L,1+Math.random()*0.12);f.m.position.z=f.z+L/2}}
  // 출격
  if(t>9.9){once('launch',()=>{if(AU.ctx&&AU.on){const a=AU.ctx.currentTime;nz(a,2.2,0.4,'bandpass',600,2600,AU.sfx);pulse(a,120,1.8,0.06,.5,AU.sfx,700)}});
    const u=t-9.9,z=-0.5*72*u*u;IN.jet.position.set(0,1.2+Math.max(0,-z-70)*0.14,z);IN.jet.rotation.x=Math.max(0,-z-70)*0.004;
    if(u>1.7)introFlash=Math.max(introFlash,clamp((u-1.7)/0.55,0,1))}
  // 원테이크 카메라
  C.fov=port?(t<7?78:68):(t<7?50:48);camAt(port?IN.pathP:IN.pathL,t,C);
  const sh=(t>8.2&&t<11)?(t>9.25?0.18:0.06):0;if(sh){C.position.x+=(Math.random()-.5)*sh;C.position.y+=(Math.random()-.5)*sh}
  C.updateProjectionMatrix();
  if(t>=INTRO_END)finishIntro();
}
function drawIntro(dt){
  const g=hx;g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,cw,ch);
  const bar=Math.round(ch*0.1);g.fillStyle='#000';g.fillRect(0,0,cw,bar);g.fillRect(0,ch-bar,cw,bar);
  if(introSub){const[t0,who,txt]=introSub;const n=Math.min(txt.length,Math.floor(introSubT*28));
    g.textAlign='center';g.textBaseline='middle';g.shadowColor='#000';g.shadowBlur=4;
    if(who){g.fillStyle='#7fd0ff';g.font='800 11px ui-monospace,monospace';g.fillText(who,cw/2,ch-bar-40)}
    g.fillStyle='#ffffff';g.font=(who?'700 15px':'900 22px')+' ui-monospace,monospace';g.fillText(txt.slice(0,n),cw/2,ch-bar-20);g.shadowBlur=0}
  g.textAlign='right';g.fillStyle='rgba(255,255,255,.75)';g.font='700 12px ui-monospace,monospace';g.fillText('TAP TO SKIP ▶▶',cw-14,bar/2+(safeT/2));
  if(introFlash>0){g.fillStyle=`rgba(255,255,255,${introFlash})`;g.fillRect(0,0,cw,ch);if(IN.t<11.5)introFlash=Math.max(0,introFlash-dt*2.5)}
}
addEventListener('pointerdown',()=>{if(state==='intro'&&IN.t>IN.t0+0.4)finishIntro();else if(state==='return'&&RT.t>0.5)finishReturn()});
addEventListener('keydown',e=>{if(!['Space','Enter','Escape'].includes(e.code))return;if(state==='intro'&&IN.t>IN.t0+0.4)finishIntro();else if(state==='return'&&RT.t>0.5)finishReturn()});

/* =====================================================================
   귀환(공중 기지 착함) → 정비 점검 → 재발진
   ===================================================================== */
const RT={built:false,t:0};
function buildBase(){
  RT.scene=new THREE.Scene();
  const c=document.createElement('canvas');c.width=4;c.height=128;const g=c.getContext('2d'),gr=g.createLinearGradient(0,0,0,128);gr.addColorStop(0,'#123a8a');gr.addColorStop(0.55,'#5aa0e8');gr.addColorStop(0.8,'#ffd2b0');gr.addColorStop(1,'#fff0e0');g.fillStyle=gr;g.fillRect(0,0,4,128);
  RT.scene.background=new THREE.CanvasTexture(c);RT.scene.fog=new THREE.Fog(0xcfe2ff,600,2600);
  RT.ship=new THREE.Group();RT.scene.add(RT.ship);
  RT.hull=new THREE.Mesh(voxGeo(skyShipShape(),[-24,24,-8,15,-41,42],4,false),VOXMAT);RT.hull.position.set(2,-32,2);RT.ship.add(RT.hull);
  RT.blink=[];for(let i=0;i<8;i++){const m=new THREE.Mesh(new THREE.BoxGeometry(2.2,2.2,2.2),new THREE.MeshBasicMaterial({color:0x9ad8ff}));m.position.set(i%2?20:-20,-5,-178-Math.floor(i/2)*24);RT.ship.add(m);RT.blink.push(m)}
  RT.thr=[];for(const sd of[-1,1])for(const xx of[7*4,21*4]){const m=new THREE.Mesh(new THREE.BoxGeometry(xx>40?10:8,xx>40?8:8,6),new THREE.MeshBasicMaterial({color:0xffb040,transparent:true,opacity:.7}));m.position.set(sd*xx,xx>40?-2:-14,xx>40?-91:-167);m.userData.z=m.position.z;RT.ship.add(m);RT.thr.push(m)}
  const cg=[0,1,2].map(i=>voxGeo(cloudShape(900+i),[-11,11,0,6,-8,8],10,false));RT.clouds=[];
  for(let i=0;i<80;i++){const m=new THREE.Mesh(cg[i%3],VOXMAT);const low=i<45;m.position.set(rnd(-1000,1000),low?rnd(-420,-330):rnd(-260,60),rnd(-1800,1400));if(!low&&Math.abs(m.position.x)<200)m.position.x+=Math.sign(m.position.x||1)*240;m.rotation.y=rnd(0,6);RT.scene.add(m);RT.clouds.push(m)}
  RT.jg=new THREE.Group();RT.scene.add(RT.jg);
  lightRig(RT.scene);RT.jet=newJet();RT.jet.rotation.y=Math.PI;RT.jg.add(RT.jet);
  RT.fl=[-1,1].map(sd=>{const m=new THREE.Mesh(new THREE.BoxGeometry(1.1,1.1,1),new THREE.MeshBasicMaterial({color:0xffb040}));const o=v2w([-14,14,0,13,-22,16],0.42,sd*4,4,15,true);m.position.copy(o);m.userData.z=o.z;RT.jet.add(m);return m});
  RT.path=new THREE.CatmullRomCurve3([[40,-330,-640],[18,-190,-480],[4,-70,-360],[0,-8,-270],[0,-5,-200],[0,-5,-150],[0,-5,-120]].map(p=>new THREE.Vector3(...p)));
  RT.built=true;
}
const RSUBS=[[0.2,'CONTROL','미션 클리어. 상승하여 모함 "ARK"와 합류하라.'],[2.6,'ARK','후방 격납 갑판 개방 — 진입 코스 OK.'],[4.6,'SYSTEM','DOCKING — 격납 완료']];
const SHIPV=46,RT_END=6.6;
function startReturn(){
  playSong('stage');
  if(!RT.built)buildBase();if(!IN.built)buildIntro();
  RT.t=0;RT.stage={};introSub=null;introFlash=0;state='return';ov.classList.add('hide');bPause.style.display='none';document.body.classList.add('cine');
}
function updReturn(dt){
  const t=(RT.t+=dt),C=IN.cam,port=cw<ch;C.aspect=cw/ch;
  for(const s of RSUBS)if(t>=s[0]&&introSub!==s){introSub=s;introSubT=0}
  if(introSub){introSubT+=dt;introBlip-=dt;const n=Math.floor(introSubT*28);if(n<=introSub[2].length&&introBlip<=0&&AU.ctx&&AU.on){introBlip=0.05;pulse(AU.ctx.currentTime,1300+Math.random()*300,0.03,0.035,.25,AU.sfx)}}
  // 모함: 전진 + 완만한 상하·롤
  const S=RT.ship;S.position.set(0,Math.sin(t*0.8)*3,SHIPV*t);S.rotation.set(Math.sin(t*0.6)*0.012,0,Math.sin(t*0.5)*0.02);
  for(let i=0;i<RT.blink.length;i++)RT.blink[i].material.color.setHex(Math.floor(t*6-Math.floor(i/2))%4===0?0xffffff:0x4a9ad8);
  for(const m of RT.thr){const L=1+Math.random()*0.6;m.scale.z=L;m.position.z=m.userData.z-L*3}
  // 기체 경로(모함 기준 상대좌표)
  const u=Math.min(1,t/5.4),e=1-Math.pow(1-u,1.6),u2=Math.min(1,e+0.015);
  const p=RT.path.getPointAt(e),q=RT.path.getPointAt(u2);
  const J=RT.jg;J.position.set(p.x,p.y+S.position.y,p.z+S.position.z);
  if(u<1){tA.set(q.x,q.y+S.position.y,q.z+S.position.z+(e>=0.985?1:0));J.lookAt(tA)}
  RT.jet.rotation.z=Math.sin(t*1.7)*0.2*(1-u);J.visible=t<5.9;
  const thrust=t<2.6?1:t<4.6?0.6:0.2;for(const f of RT.fl){const L=1+thrust*2.4+Math.random()*0.6;f.scale.set(1,1,L);f.position.z=f.userData.z+L/2}
  once2('climb',()=>{if(AU.ctx&&AU.on){const a=AU.ctx.currentTime;nz(a,1.8,0.25,'bandpass',1200,400,AU.sfx)}});
  if(t>2.6)once2('bay',()=>{if(AU.ctx&&AU.on){const a=AU.ctx.currentTime;pulse(a,440,0.12,0.05,.5,AU.sfx);pulse(a+0.15,660,0.12,0.05,.5,AU.sfx)}});
  if(t>5.3)once2('dock',()=>{if(AU.ctx&&AU.on){const a=AU.ctx.currentTime;nz(a,0.5,0.3,'lowpass',700,150,AU.sfx);pulse(a,160,0.3,0.06,.5,AU.sfx,80)}shakeC=0.8});
  // 카메라
  const st=tB.set(0,-5+S.position.y,-160+S.position.z);
  if(t<2.6){C.fov=port?74:58;C.position.set(J.position.x-30,J.position.y-22,J.position.z-46);C.lookAt(lerp(J.position.x,st.x,0.35),lerp(J.position.y,st.y,0.35)+10,lerp(J.position.z,st.z,0.35))}
  else if(t<4.3){const k=(t-2.6)/1.7;C.fov=port?70:50;const d=port?620:430;C.position.set(-d+k*40,70+S.position.y-k*14,S.position.z-150+k*30);C.lookAt(0,10+S.position.y,S.position.z-30)}
  else{const k=Math.min(1,(t-4.3)/1.4);C.fov=port?72:55;C.position.set(lerp(70,40,k),st.y+lerp(46,22,k),st.z-lerp(170,120,k));C.lookAt(st.x,st.y+2,st.z+10)}
  shakeC=Math.max(0,(shakeC||0)-dt*2);if(shakeC>0){C.position.x+=(Math.random()-.5)*shakeC*2;C.position.y+=(Math.random()-.5)*shakeC*2}
  C.updateProjectionMatrix();
  if(t>RT_END-0.6)introFlash=Math.min(1,(t-(RT_END-0.6))/0.5);
  if(t>RT_END)finishReturn();
}
let shakeC=0;
function once2(k,fn){if(!RT.stage[k]){RT.stage[k]=1;fn()}}
function finishReturn(){if(state!=='return')return;document.body.classList.remove('cine');introFlash=0;showDebrief()}
/* 정비 점검(디브리핑) */
let DB={t:0,from:0,sparks:null,step:0,log:[],last:false};
/* 업그레이드: 상한은 파일럿 레벨에 따라 열림, 포인트가 있어야 강화 */
const UPG=[
 {k:'gun',n:'WEAPON',kr:'기관포',max:()=>GUN_MAX,lv:()=>P.gunLv,cap:()=>Math.min(GUN_MAX,2+Math.floor(P.lv/2)),cost:()=>300*P.gunLv,up:()=>{P.gunLv++},show:()=>GUN[P.gunLv].name},
 {k:'msl',n:'MISSILE',kr:'미사일',max:()=>MSL_MAX,lv:()=>P.mslLv,cap:()=>Math.min(MSL_MAX,1+Math.floor(P.lv/2)),cost:()=>350*P.mslLv,up:()=>{P.mslLv++;P.mslCap=Math.min(24,P.mslCap+3);P.msl=P.mslCap},show:()=>'장탄 '+P.mslCap+(salvo()>1?' ×'+salvo():'')},
 {k:'en',n:'ENERGY',kr:'최대 에너지',max:()=>5,lv:()=>P.enLv,cap:()=>Math.min(5,1+Math.floor(P.lv/2)),cost:()=>400*(P.enLv+1),up:()=>{P.enLv++;applyHullUpgrade()},show:()=>'MAX '+P.maxhp},
 {k:'spd',n:'ENGINE',kr:'엔진 출력',max:()=>SPD_MAX,lv:()=>P.spdLv,cap:()=>Math.min(SPD_MAX,Math.floor((P.lv+1)/3)),cost:()=>450*(P.spdLv+1),up:()=>{P.spdLv++},show:()=>'+'+P.spdLv*10+' SPD'},
 {k:'agi',n:'FRAME',kr:'기동성',max:()=>AGI_MAX,lv:()=>P.agiLv,cap:()=>Math.min(AGI_MAX,Math.floor((P.lv+1)/3)),cost:()=>400*(P.agiLv+1),up:()=>{P.agiLv++},show:()=>P.agiLv?'배럴롤':'—'}];
const FREE_FIX=0.5,FIX_PT=4,ARM_PT=10;
function fixCost(){return Math.ceil(Math.max(0,P.maxhp-Math.max(P.hp,P.maxhp*FREE_FIX))*FIX_PT)}
function armCost(){return(P.mslCap-P.msl)*ARM_PT}
function canUp(u){return u.lv()<u.cap()&&P.pts>=u.cost()}
function doFix(){const c=fixCost();if(c<=0)return false;if(P.pts>=c){P.pts-=c;P.hp=P.maxhp;DB.log.push('수리 완료 −'+c)}else{const hp=Math.floor(P.pts/FIX_PT);P.pts-=hp*FIX_PT;P.hp=Math.min(P.maxhp,Math.max(P.hp,P.maxhp*FREE_FIX)+hp);if(hp<=0)return false;DB.log.push('부분 수리 +'+hp+' (포인트 부족)')}SFX.item();return true}
function doArm(){const c=armCost();if(c<=0)return false;if(P.pts>=c){P.pts-=c;P.msl=P.mslCap;DB.log.push('미사일 재장전 −'+c)}else{const n=Math.floor(P.pts/ARM_PT);if(n<=0)return false;P.pts-=n*ARM_PT;P.msl+=n;DB.log.push('미사일 '+n+'발 보급')}SFX.item();return true}
function doUp(u){if(!canUp(u))return false;const c=u.cost();P.pts-=c;u.up();DB.log.push(u.n+' Lv'+u.lv()+' 강화 −'+c);SFX.bonus();return true}
const AUTO_UPGRADE_MAX=3;
function autoStep(){
  if(P.hp<P.maxhp&&fixCost()>0&&P.pts>=FIX_PT&&doFix())return true;
  if(armCost()>0&&P.pts>=ARM_PT&&doArm())return true;
  const c=UPG.filter(u=>u.lv()<AUTO_UPGRADE_MAX&&canUp(u)).sort((a,b)=>a.cost()-b.cost());return c.length?doUp(c[0]):false}
function showDebrief(){
  state='debrief';DB.t=0;DB.step=0.9;DB.log=[];const st=stage;DB.last=st%NSTAGE===0;
  IN.doorL.position.x=0;IN.doorR.position.x=0;IN.jet.position.set(0,1.2,0);IN.jet.rotation.set(0,0,0);IN.pilot.visible=false;IN.holo.visible=true;
  for(const f of IN.flame)f.m.visible=false;for(const n of IN.noz)n.material.color.setHex(0x220806);for(const c of IN.core)c.material.opacity=0;
  if(!DB.sparks){DB.sparks=[0,1,2,3].map(()=>{const m=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.7,0.7),new THREE.MeshBasicMaterial({color:0xfff0a0}));IN.scene.add(m);return m})}
  // 무상 기본 정비: 에너지 50%까지
  if(P.hp<P.maxhp*FREE_FIX){P.hp=P.maxhp*FREE_FIX;DB.log.push('기본 정비: 에너지 50%까지 무상')}
  const reward=800+stageSourceNumber(st)*200+stageKills*15+Math.round(P.hp)*4;P.pts+=reward;DB.reward=reward;P.inv=0;
  ov.classList.remove('ttl');ov.classList.add('dbf');ov.classList.remove('hide');bPause.style.display='none';
  renderDB();playSong('stage');
}
function renderDB(){
  const st=stage,th=THEMES[(st-1)%NSTAGE],nx=THEMES[st%NSTAGE],last=DB.last;
  const bar=(v,m,c)=>`<span style="display:inline-block;width:86px;height:7px;background:#123;vertical-align:middle;margin:0 5px"><i style="display:block;height:100%;width:${Math.round(clamp(v/m,0,1)*100)}%;background:${c}"></i></span>`;
  const pips=u=>{let h='';for(let i=1;i<=u.max();i++)h+=`<i style="display:inline-block;width:9px;height:9px;margin-right:2px;background:${i<=u.lv()?'#9affb0':i<=u.cap()?'#2e5a3a':'#3a2020'};border:1px solid ${i<=u.cap()?'#6fbf86':'#6a3434'}"></i>`;return h};
  const btn=(id,lbl,on)=>`<button data-b="${id}" style="font:800 10px ui-monospace,monospace;padding:3px 7px;border-radius:3px;border:2px solid ${on?'#ffe36a':'#555'};background:${on?'#8a3524':'#222'};color:${on?'#ffe36a':'#777'};float:right">${lbl}</button>`;
  const fc=fixCost(),ac=armCost();
  let rows=`<div style="clear:both">ENERGY${bar(P.hp,P.maxhp,'#9affb0')}${Math.round(P.hp)}/${P.maxhp}${fc>0?btn('fix','수리 '+fc,P.pts>=FIX_PT):''}</div>
  <div style="clear:both">MISSILE${bar(P.msl,P.mslCap,'#9ac4ff')}${P.msl}/${P.mslCap}${ac>0?btn('arm','장전 '+ac,P.pts>=ARM_PT):''}</div>`;
  for(const u of UPG){const full=u.lv()>=u.max(),capd=u.lv()>=u.cap();
    rows+=`<div style="clear:both;margin-top:3px">${u.n} <span style="opacity:.7">${u.kr}</span> ${pips(u)} <span style="color:#ffe36a">${u.show()}</span>${full?btn('x','MAX',false):capd?btn('x','PILOT Lv↑',false):btn(u.k,'+ '+u.cost(),P.pts>=u.cost())}</div>`}
  const log=DB.log.slice(-3).map(l=>`<div style="color:#ffe36a">▸ ${l}</div>`).join('');
  card.innerHTML=`<div class="sub">${last?'FINAL ':''}MISSION ${st} COMPLETE · ${th.name}</div>
  <p style="font:700 11px ui-monospace,monospace;margin:4px 0">SCORE <b>${String(score).padStart(8,'0')}</b> · KILLS <b>${stageKills}</b> · PILOT LV <b>${P.lv}</b> · 보상 <b>+${DB.reward}PT</b></p>
  <div class="lbl" style="margin-top:6px">HANGAR · 정비 / 강화 <span style="float:right;color:#ffe36a;letter-spacing:.05em">${P.pts} PT</span></div>
  <div class="perks" style="line-height:1.75;margin:4px 0">${rows}<div style="clear:both;font-size:10px;opacity:.75;margin-top:4px">■ 강화됨 ■ 강화 가능 ■ 파일럿 레벨이 오르면 개방</div></div>
  <div style="min-height:44px;text-align:left;font:700 10px/1.5 ui-monospace,monospace">${log}</div>
  <div style="display:flex;gap:6px;justify-content:center;align-items:center">
   <button class="go" data-b="auto" style="font-size:11px;padding:9px 10px;${CFG.autoUp?'':'background:#222;border-color:#666;color:#999'}">AUTO 강화 ${CFG.autoUp?'ON':'OFF'} · Lv.${AUTO_UPGRADE_MAX} MAX</button>
   <button class="go" id="go">${last?'CONTINUE ▶':'출격 ▶'}</button></div>
  ${last?'':`<p style="margin:4px 0 0;font-size:11px">NEXT · STAGE ${st+1} ${nx.name} · ${nx.kr}</p>`}`;
  card.querySelectorAll('[data-b]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();const k=b.dataset.b;
    if(k==='auto'){CFG.autoUp=!CFG.autoUp;store.set('autoUp',CFG.autoUp);DB.step=0.3;SFX.click()}
    else if(k==='fix')doFix();else if(k==='arm')doArm();else{const u=UPG.find(x=>x.k===k);if(u&&!doUp(u))SFX.click()}
    renderDB()});
  document.getElementById('go').onclick=()=>{SFX.click();ov.classList.remove('dbf');if(last){showVictoryFilm();return}stage++;buildStage();startIntro('launch')};
}
function updDebrief(dt){
  const t=(DB.t+=dt),C=IN.cam;C.aspect=cw/ch;const port=cw<ch;
  const a=-0.6+Math.sin(t*0.12)*0.5;C.fov=port?70:50;C.position.set(Math.sin(a)*(port?44:40),12+Math.sin(t*0.3)*1.5,18+Math.cos(a)*(port?40:30));C.lookAt(0,5,-4);C.updateProjectionMatrix();
  const hg=IN.holoCv.getContext('2d');holoDraw(hg,'maint',false,t*30);IN.holoTex.needsUpdate=true;IN.holo.material.opacity=0.9;IN.holo.visible=true;
  for(const s of DB.sparks){s.visible=Math.random()<0.6;s.position.set(rnd(-6,6),rnd(3,8),rnd(-8,10));s.material.color.setHex(Math.random()<0.5?0xfff0a0:0x9ad8ff)}
  if(CFG.autoUp&&DB.step>0){DB.step-=dt;if(DB.step<=0){if(autoStep()){DB.step=0.42;renderDB()}else DB.step=0}}
  if(AU.ctx&&AU.on&&Math.random()<dt*3)nz(AU.ctx.currentTime,0.06,0.05,'highpass',5000,null,AU.sfx);
}

/* =====================================================================
   루프
   ===================================================================== */
applyTheme(THEMES[0]);STAGE_LEN=6000;buildWorld(THEMES[0]);for(const e of enemies)scene.remove(e.mesh);enemies=[];
showBoot();
let last=performance.now();
function frame(now){
  if(state==='cinematic'||state==='victoryFilm'){last=now;requestAnimationFrame(frame);return;}const dt=Math.min(0.05,(now-last)/1000);last=now;
  if(state==='title'&&ov.classList.contains('deck')){idleT+=dt;if(idleT>=60){idleT=0;startIntro()}}else idleT=0;
  const ng=!['play','clear','over','crash'].includes(state);if(document.body.classList.contains('nogame')!==ng)document.body.classList.toggle('nogame',ng);
  if(state==='title'&&ov.classList.contains('deck')){hx.clearRect(0,0,hud.width,hud.height);renderHangar(now);}
  else if(state==='intro'){updIntro(dt);renderFilm(IN.scene,IN.cam);drawIntro(dt)}
  else if(state==='return'){updReturn(dt);renderFilm(RT.scene,IN.cam);drawIntro(dt)}
  else if(state==='debrief'){updDebrief(dt);renderFilm(IN.scene,IN.cam);hx.setTransform(1,0,0,1,0,0);hx.clearRect(0,0,hud.width,hud.height)}
  else{update(dt);renderFilm(scene,camera);drawHUD(dt)}
  requestAnimationFrame(frame)}
requestAnimationFrame(frame);
