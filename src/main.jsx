import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const SERVICES = [
  { id:'chatgpt', name:'ChatGPT', url:'https://chatgpt.com/', color:'#10a37f', icon:'C' },
  { id:'gemini', name:'Gemini', url:'https://gemini.google.com/app', color:'#4f8df7', icon:'G' },
  { id:'claude', name:'Claude', url:'https://claude.ai/new', color:'#d97757', icon:'A' },
];
const MODES = [
  {id:'all', icon:'🤖', label:'AI 비교'},
  {id:'image', icon:'🎨', label:'이미지'},
  {id:'debate', icon:'⚖️', label:'AI 토론'},
  {id:'shopping', icon:'🛍️', label:'쇼핑'},
];

function editorScript(text) {
  return `(() => {
    const text=${JSON.stringify(text)};
    const visible=e=>e && e.offsetParent!==null && !e.disabled;
    const candidates=[...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible);
    const el=candidates.find(e=>/prompt|message|chat|ask|질문|메시지/i.test((e.getAttribute('placeholder')||'')+' '+(e.getAttribute('aria-label')||''))) || candidates.at(-1);
    if(!el) return {ok:false,error:'입력창을 찾지 못했습니다. 로그인 또는 새 대화 화면을 확인하세요.'};
    el.focus();
    if(el.tagName==='TEXTAREA' || el.tagName==='INPUT') {
      const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set;
      setter ? setter.call(el,text) : el.value=text;
      el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
    } else {
      el.textContent=text; el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
    }
    const form=el.closest('form');
    const buttons=[...(form||document).querySelectorAll('button')].filter(visible);
    const send=buttons.find(b=>/send|submit|보내기|전송/i.test((b.getAttribute('aria-label')||'')+' '+(b.title||''))) || buttons.find(b=>b.type==='submit');
    if(send){send.click();return {ok:true,sent:true};}
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    return {ok:true,sent:true};
  })()`;
}

function App(){
  const [mode,setMode]=useState('all');
  const [active,setActive]=useState('all');
  const [prompt,setPrompt]=useState('');
  const [statuses,setStatuses]=useState(Object.fromEntries(SERVICES.map(s=>[s.id,'준비 중'])));
  const [notice,setNotice]=useState('');
  const [debateTopic,setDebateTopic]=useState('');
  const refs=useRef({});

  useEffect(()=>window.dascan?.onReady(id=>setStatuses(v=>({...v,[id]:'준비'}))),[]);
  useLayoutEffect(()=>{
    const update=()=>{
      const layouts=SERVICES.flatMap(s=>{
        const el=refs.current[s.id];
        if(!el||el.offsetParent===null)return[];
        const r=el.getBoundingClientRect(); return [{id:s.id,x:r.x,y:r.y,width:r.width,height:r.height}];
      });
      window.dascan?.layout(layouts);
    };
    update(); const observer=new ResizeObserver(update); observer.observe(document.body); window.addEventListener('resize',update);
    return()=>{observer.disconnect();window.removeEventListener('resize',update);window.dascan?.layout([])};
  },[active,mode]);

  const sendTo = async (ids,text) => {
    if(!text.trim()) return;
    setNotice('AI에 질문을 보내는 중…');
    const results=await Promise.all(ids.map(async id=>{
      try { const result=await window.dascan.send({id,script:editorScript(text)}); return [id,result]; }
      catch(e){ return [id,{ok:false,error:e.message}]; }
    }));
    const failed=results.filter(([,r])=>!r?.ok);
    setStatuses(v=>({...v,...Object.fromEntries(results.map(([id,r])=>[id,r?.ok?'질문 전송':'확인 필요']))}));
    setNotice(failed.length ? `${failed.length}개 서비스의 입력창을 찾지 못했습니다. 로그인 상태를 확인하세요.` : '질문을 모두 보냈습니다.');
    setTimeout(()=>setNotice(''),4500);
  };
  const submit=()=>{
    if(mode==='shopping') return;
    const ids=active==='all'?SERVICES.map(s=>s.id):[active];
    const prefix=mode==='image'?'다음 설명에 맞는 이미지를 생성해줘. ':'';
    sendTo(ids,prefix+prompt); setPrompt('');
  };
  const shop=()=>{
    if(!prompt.trim()) return;
    const q=encodeURIComponent(prompt);
    window.open(`https://www.coupang.com/np/search?q=${q}`);
    window.open(`https://search.shopping.naver.com/search/all?query=${q}`);
    window.open(`https://www.daangn.com/kr/buy-sell/?search=${q}`);
    setPrompt('');
  };
  const startDebate=()=>{
    if(!debateTopic.trim()) return;
    const roles={chatgpt:'당신은 찬성 측입니다. 핵심 근거 3개로 주장하세요.',gemini:'당신은 반대 측입니다. 찬성 측이 제기할 법한 주장도 반박하며 근거 3개로 답하세요.',claude:'당신은 중립 사회자입니다. 쟁점, 판단 기준, 잠정 결론을 구조화하세요.'};
    SERVICES.forEach(s=>sendTo([s.id],`토론 주제: ${debateTopic}\n${roles[s.id]}`));
  };
  const crossCheck=()=>sendTo(SERVICES.map(s=>s.id),'현재 대화에서 당신이 제시한 답변을 스스로 교차검토하세요. 사실 오류, 빠진 관점, 불확실한 부분을 구분하고 개선된 최종 답을 제시하세요.');
  const synthesize=()=>sendTo(SERVICES.map(s=>s.id),'현재 대화의 답변을 다시 검토한 뒤, 핵심 결론·공통점·차이점·실행 권고를 간결하게 종합하세요.');

  return <div className="app">
    <aside className="rail">
      <div className="brand">D</div>
      {MODES.map(m=><button key={m.id} className={mode===m.id?'railbtn active':'railbtn'} title={m.label} onClick={()=>{setMode(m.id);setActive('all')}}><span>{m.icon}</span></button>)}
      <div className="spacer"/><button className="railbtn" title="도움말" onClick={()=>setNotice('각 AI에 먼저 로그인한 뒤 상단 입력창에서 질문하세요.')}>?</button>
    </aside>
    <main>
      <header className="tabs">
        <button className={active==='all'?'tab active':'tab'} onClick={()=>setActive('all')}><span>▥</span> 전체</button>
        {SERVICES.map(s=><button key={s.id} className={active===s.id?'tab active':'tab'} onClick={()=>setActive(s.id)}><i style={{background:s.color}}/> {s.name}</button>)}
        <button className="tab" onClick={()=>window.open('https://google.com')}>🌐 Google</button>
        <button className="tab plus">＋</button>
      </header>
      <section className="toolbar">
        <select aria-label="전송 대상" value={active} onChange={e=>setActive(e.target.value)}><option value="all">🌐 모든 AI</option>{SERVICES.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();mode==='shopping'?shop():submit()}}} placeholder={mode==='shopping'?'찾을 상품을 입력하세요':mode==='image'?'만들고 싶은 이미지를 설명하세요':'모든 AI에게 질문하기'}/>
        <button className="ghost" title="교차검토" onClick={crossCheck}>⇄ 교차검토</button>
        <button className="ghost" title="종합" onClick={synthesize}>⑂ 종합</button>
        <button className="send" onClick={mode==='shopping'?shop:submit}>↑</button>
      </section>
      {mode==='debate'&&<section className="debatebar"><b>AI 토론</b><input value={debateTopic} onChange={e=>setDebateTopic(e.target.value)} placeholder="토론 주제를 입력하세요"/><button onClick={startDebate}>토론 시작</button></section>}
      {notice&&<div className="toast">{notice}</div>}
      <section className={`panes ${active==='all'?'grid':'single'}`}>
        {SERVICES.map(s=><article key={s.id} className={active!=='all'&&active!==s.id?'hidden':'pane'}>
          <div className="panehead"><span><i style={{background:s.color}}/> {s.name}</span><em>{statuses[s.id]}</em><button onClick={()=>window.dascan?.reload(s.id)}>↻</button></div>
          <div className="viewslot" ref={el=>refs.current[s.id]=el}/>
        </article>)}
      </section>
    </main>
  </div>
}
createRoot(document.getElementById('root')).render(<App/>);
