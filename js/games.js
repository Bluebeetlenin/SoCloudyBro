// -- IN-CHAT MINI-GAMES (unified framework: lobby → play → results) ------------
// Every game is a message with `msg.game = {type, id, phase, hostId, players, ...}`.
// Games needing 3+ people use a lobby (host starts, others tap Join, host
// starts the round); 2-player games (Tic-Tac-Toe) skip straight to playing.
// Client-side "hidden" info (a Hangman word, a Werewolf role) is hidden by
// not rendering it to anyone but the right player — same trust model as the
// rest of this app, not cryptographically private from someone in devtools.
const GAME_DEFS={
  tictactoe:{icon:'⭕',label:'Tic-Tac-Toe',minPlayers:2,maxPlayers:2,needsLobby:false},
  hangman:{icon:'🔤',label:'Hangman',minPlayers:2,maxPlayers:12,needsLobby:true},
  trivia:{icon:'❓',label:'Trivia Battle',minPlayers:2,maxPlayers:16,needsLobby:true},
  typingrace:{icon:'⌨️',label:'Typing Race',minPlayers:2,maxPlayers:8,needsLobby:true},
  werewolf:{icon:'🐺',label:'Werewolf',minPlayers:4,maxPlayers:16,needsLobby:true}
};
function gamePlayerPool(){
  if(!activeConvo) return [];
  if(activeConvo.type==='group'){
    const conv=getActiveConvoObj();
    return conv?(conv.participants||conv.members||[]):[];
  }
  return [me.number,activeConvo.number];
}
function openGameMenu(){
  if(!activeConvo){ showToast('Open a chat first',scbErr('SCB-GAME-01','Open a chat before starting a game.')); return; }
  const body=document.getElementById('game-menu-body');
  body.innerHTML=Object.entries(GAME_DEFS).map(([id,def])=>{
    const pool=gamePlayerPool();
    const disabled=pool.length<def.minPlayers;
    return '<div class="sb-item" style="border-radius:var(--r-sm);'+(disabled?'opacity:.4;cursor:not-allowed':'cursor:pointer')+'" '+(disabled?'':'data-id="'+esc(id)+'" onclick="pickGame(this.dataset.id)"')+'>'
      +'<div class="avatar" style="width:34px;height:34px;font-size:16px;background:var(--accent);color:#fff">'+def.icon+'</div>'
      +'<div class="sb-item-info"><div class="sb-item-name">'+def.label+'</div><div class="sb-item-preview">'+def.minPlayers+'+ players'+(disabled?' — not enough people here':'')+'</div></div>'
      +'</div>';
  }).join('');
  openModal('game-menu-modal');
}
async function pickGame(type){
  closeModal('game-menu-modal');
  const def=GAME_DEFS[type];
  if(!def) return;
  if(!convosCache) await getConvos();
  const key=activeConvo.key;
  let c=convosCache.find(x=>x&&x.key===key);
  if(!c){ c={key,participants:activeConvo.members||[me.number,activeConvo.number],messages:[]}; convosCache.push(c); }
  let game;
  if(type==='tictactoe'){
    let opponent=activeConvo.number;
    if(activeConvo.type==='group'){
      opponent=await pickOpponentPrompt();
      if(!opponent) return;
    }
    game={type,id:'g_'+Date.now().toString(36),board:Array(9).fill(null),players:[me.number,opponent],turn:me.number,winner:null};
  }else if(type==='hangman'){
    const word=prompt('Secret word for others to guess (letters only, kept hidden from them):');
    if(!word||!/^[a-zA-Z ]{2,20}$/.test(word.trim())){ showToast('Cancelled',scbErr('SCB-GAME-02','Enter a word of letters only.')); return; }
    game={type,id:'g_'+Date.now().toString(36),phase:'lobby',hostId:me.number,setterId:me.number,word:word.trim().toUpperCase(),players:[me.number],guessed:[],wrong:0,maxWrong:6,winnerIds:[]};
  }else if(type==='trivia'){
    game={type,id:'g_'+Date.now().toString(36),phase:'lobby',hostId:me.number,players:[me.number],scores:{},questionOrder:shuffledTriviaOrder(),roundIdx:-1,answered:{},revealed:false};
  }else if(type==='typingrace'){
    game={type,id:'g_'+Date.now().toString(36),phase:'lobby',hostId:me.number,players:[me.number],sentence:pickRaceSentence(),startAt:null,finishTimes:{}};
  }else if(type==='werewolf'){
    game={type,id:'g_'+Date.now().toString(36),phase:'lobby',hostId:me.number,players:[me.number],roles:{},alive:{},round:0,log:[],night:{wolfTargets:{},seerCheck:null},day:{votes:{}},winner:null};
  }
  const msg={id:'msg_'+Date.now().toString(36),from:me.number,time:Date.now(),seen:[],game};
  if(activeConvo.type==='group') {
    msg.channelId=activeChannelId||'general';
    if (Array.isArray(c.pendingApproval) && c.pendingApproval.includes(me.number)) msg.quarantined = true;
  }
  c.messages.push(msg);
  await saveConvos();
  lastMsgHash=''; renderMessages(c.messages);
}
function pickOpponentPrompt(){
  return new Promise(resolve=>{
    const pool=gamePlayerPool().filter(n=>n!==me.number);
    if(!pool.length){ showToast('No one else here',scbErr('SCB-GAME-03','There is no one else in this chat to pick.')); resolve(null); return; }
    const names=pool.map(n=>(dec((lookupUser(n)||{}).name)||'#'+n)+' (#'+n+')').join('\n');
    const input=prompt('Play against which number?\n'+names);
    const num=parseInt(input);
    if(!num||!pool.includes(num)){ showToast('Cancelled',scbErr('SCB-GAME-04','That wasn\'t a player in this chat, so the game was cancelled.')); resolve(null); return; }
    resolve(num);
  });
}
function gameMsgOf(msgId){
  if(!convosCache||!activeConvo) return null;
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  return c?c.messages.find(x=>x.id===msgId):null;
}
async function saveGame(){
  lastMsgHash='';
  await saveConvos();
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(c) renderMessages(c.messages);
}
// Every game-mutating handler below re-reads the game off convosCache and
// re-checks, from that freshly-read state, both the phase it expects and that
// the acting player is a participant in THAT game — never just a member of the
// conversation, and never trusting the state the button was rendered from
// (a stale card, a double-click or a re-render race would otherwise let a
// finished game be scored again or a running one be reset).
function gameHasPlayer(g,num){ return !!g&&Array.isArray(g.players)&&g.players.includes(num); }
async function joinGame(msgId){
  const m=gameMsgOf(msgId); if(!m||!m.game||m.game.phase!=='lobby') return;
  if(m.game.players.includes(me.number)) return;
  // maxPlayers was declared in GAME_DEFS but never enforced: a lobby could be
  // joined without limit, which overflows role assignment (Werewolf) and the
  // results UI.
  const def=GAME_DEFS[m.game.type];
  if(def&&def.maxPlayers&&m.game.players.length>=def.maxPlayers){
    showToast('Game is full',scbErr('SCB-GAME-05','This game takes at most '+def.maxPlayers+' players.'));
    return;
  }
  m.game.players.push(me.number);
  await saveGame();
}
async function startGameFromLobby(msgId){
  const m=gameMsgOf(msgId); if(!m||!m.game) return;
  const g=m.game;
  if(g.hostId!==me.number) return;
  // Phase re-check: without it a second click on a stale "Start" button (an
  // easy double-tap, or a click landing just before the re-render) re-ran the
  // setup for a game already in progress — re-rolling every Werewolf role and
  // resetting alive/round mid-game, or wiping Trivia scores back to zero.
  if(g.phase!=='lobby') return;
  const def=GAME_DEFS[g.type];
  if(g.players.length<def.minPlayers){ showToast('Need more players',scbErr('SCB-GAME-06','Wait for at least '+def.minPlayers+'.')); return; }
  if(g.type==='trivia'){ g.phase='playing'; g.players.forEach(p=>{ if(!(p in g.scores)) g.scores[p]=0; }); nextTriviaQuestion(g); }
  else if(g.type==='typingrace'){ g.phase='countdown'; g.startAt=Date.now()+3000; }
  else if(g.type==='hangman'){ g.phase='playing'; }
  else if(g.type==='werewolf'){ assignWerewolfRoles(g); g.phase='night'; g.round=1; g.log.push('Round 1 — night falls.'); }
  await saveGame();
}
function renderGame(game,msgId,body){
  const def=GAME_DEFS[game.type];
  if(def&&def.needsLobby&&game.phase==='lobby'){ body.appendChild(renderLobby(game,msgId,def)); return; }
  if(game.type==='tictactoe') return renderTicTacToe(game,msgId,body);
  if(game.type==='hangman') return renderHangman(game,msgId,body);
  if(game.type==='trivia') return renderTrivia(game,msgId,body);
  if(game.type==='typingrace') return renderTypingRace(game,msgId,body);
  if(game.type==='werewolf') return renderWerewolf(game,msgId,body);
}
function renderLobby(game,msgId,def){
  const players=Array.isArray(game.players)?game.players:(game.players&&typeof game.players==='object'?Object.values(game.players):[]);
  const card=document.createElement('div'); card.className='game-card';
  card.innerHTML='<div class="game-title">'+def.icon+' '+def.label+'</div>'
    +'<div class="game-status">'+players.length+' joined (need '+def.minPlayers+'+)</div>'
    +'<div style="font-size:11px;color:var(--muted);margin:4px 0 8px">'+players.map(p=>esc(dec((lookupUser(p)||{}).name)||'#'+p)).join(', ')+'</div>';
  const btnRow=document.createElement('div'); btnRow.style.cssText='display:flex;gap:6px';
  if(!players.includes(me.number)){
    const jb=document.createElement('button'); jb.className='btn btn-sm'; jb.textContent='Join'; jb.onclick=()=>joinGame(msgId);
    btnRow.appendChild(jb);
  }
  if(game.hostId===me.number){
    const sb=document.createElement('button'); sb.className='btn btn-sm btn-ghost'; sb.textContent='Start'; sb.onclick=()=>startGameFromLobby(msgId);
    btnRow.appendChild(sb);
  }
  card.appendChild(btnRow);
  return card;
}
// -- Tic-Tac-Toe (rebuilt) ------------------------------------------------------
const TTT_LINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function tttWinner(board){
  for(const [a,b,c] of TTT_LINES){ if(board[a]&&board[a]===board[b]&&board[b]===board[c]) return board[a]; }
  if(board.every(x=>x)) return 'draw';
  return null;
}
async function playGameMove(msgId,cellIdx){
  const m=gameMsgOf(msgId); if(!m||!m.game||m.game.winner) return;
  const g=m.game;
  if(!Number.isInteger(cellIdx)||cellIdx<0||cellIdx>8) return;
  if(g.turn!==me.number||g.board[cellIdx]||!gameHasPlayer(g,me.number)) return;
  const mySymbol=g.players[0]===me.number?'X':'O';
  g.board[cellIdx]=mySymbol;
  const result=tttWinner(g.board);
  if(result){ g.winner=result==='draw'?'draw':me.number; }
  else{ g.turn=g.players.find(p=>p!==me.number); }
  await saveGame();
}
function renderTicTacToe(game,msgId,body){
  const players=Array.isArray(game.players)?game.players:(game.players&&typeof game.players==='object'?Object.values(game.players):[]);
  const board=Array.isArray(game.board)?game.board:(game.board&&typeof game.board==='object'?Object.values(game.board):Array(9).fill(''));
  const card=document.createElement('div'); card.className='game-card';
  const title=document.createElement('div'); title.className='game-title'; title.textContent='⭕ Tic-Tac-Toe'; card.appendChild(title);
  const status=document.createElement('div'); status.className='game-status';
  if(!players.includes(me.number)) status.textContent='Watching '+players.map(p=>dec((lookupUser(p)||{}).name)||'#'+p).join(' vs ');
  else if(game.winner==='draw') status.textContent="It's a draw!";
  else if(game.winner){ const wu=lookupUser(game.winner)||{}; status.textContent=(game.winner===me.number?'You':(dec(wu.name)||'They'))+' won! 🎉'; }
  else if(game.turn!=null) status.textContent=(game.turn===me.number?'Your turn':((dec((lookupUser(game.turn)||{}).name)||'Their')+" turn"))+' — you are '+(players[0]===me.number?'X':'O');
  card.appendChild(status);
  const grid=document.createElement('div'); grid.className='game-grid';
  board.forEach((cell,i)=>{
    const btn=document.createElement('button');
    btn.className='game-cell'+(cell?' filled':'');
    btn.textContent=cell||'';
    btn.disabled=!!cell||!!game.winner||game.turn!==me.number||!players.includes(me.number);
    btn.onclick=()=>playGameMove(msgId,i);
    grid.appendChild(btn);
  });
  card.appendChild(grid);
  body.appendChild(card);
}


// -- Hangman ---------------------------------------------------------------
const HANGMAN_STAGES=['🙂','😕','😟','😨','😰','💀','⚰️'];
async function guessHangmanLetter(msgId,letter){
  const m=gameMsgOf(msgId); if(!m||!m.game) return;
  const g=m.game;
  if(g.phase!=='playing') return; // no guessing before the host starts, or after
  if(g.setterId===me.number||(g.winnerIds||[]).length||g.wrong>=g.maxWrong) return;
  // Participation check (same fix Trivia got, see submitTriviaAnswer): this
  // used to silently add the caller to g.players with no maxPlayers check,
  // so anyone in the conversation could guess without joining the lobby and
  // overflow GAME_DEFS.hangman.maxPlayers.
  if(!gameHasPlayer(g,me.number)) return;
  letter=letter.toUpperCase();
  if(g.guessed.includes(letter)) return;
  g.guessed.push(letter);
  if(!g.word.includes(letter)) g.wrong++;
  const solved=g.word.split('').every(ch=>ch===' '||g.guessed.includes(ch));
  if(solved) g.winnerIds=[...new Set([...(g.winnerIds||[]),me.number])];
  await saveGame();
}
function renderHangman(game,msgId,body){
  const guessed=Array.isArray(game.guessed)?game.guessed:(game.guessed&&typeof game.guessed==='object'?Object.values(game.guessed):[]);
  const winnerIds=Array.isArray(game.winnerIds)?game.winnerIds:(game.winnerIds&&typeof game.winnerIds==='object'?Object.values(game.winnerIds):[]);
  const card=document.createElement('div'); card.className='game-card';
  card.innerHTML='<div class="game-title">🔤 Hangman</div>';
  const lost=(game.wrong||0)>=(game.maxWrong||6);
  const won=winnerIds.length>0;
  const word=game.word||'???';
  const masked=word.split('').map(ch=>ch===' '?' ':(guessed.includes(ch)||lost?ch:'_')).join(' ');
  const status=document.createElement('div'); status.className='game-status';
  status.textContent=HANGMAN_STAGES[Math.min(game.wrong||0,HANGMAN_STAGES.length-1)]+' '+masked;
  card.appendChild(status);
  const sub=document.createElement('div'); sub.style.cssText='font-size:11px;color:var(--muted);margin:2px 0 8px';
  if(me.number===game.setterId) sub.textContent="You set the word — watch others guess.";
  else if(won) sub.textContent=(dec((lookupUser(winnerIds[0])||{}).name)||'Someone')+' solved it! 🎉';
  else if(lost) sub.textContent='Out of guesses — the word was '+word;
  else sub.textContent=(game.wrong||0)+'/'+(game.maxWrong||6)+' wrong guesses';
  card.appendChild(sub);
  if(me.number!==game.setterId&&!won&&!lost){
    const grid=document.createElement('div'); grid.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);gap:3px';
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(l=>{
      const btn=document.createElement('button'); btn.className='game-cell'; btn.style.cssText='min-height:26px;font-size:11px';
      btn.textContent=l; btn.disabled=guessed.includes(l);
      btn.onclick=()=>guessHangmanLetter(msgId,l);
      grid.appendChild(btn);
    });
    card.appendChild(grid);
  }
  body.appendChild(card);
}

// -- Trivia Battle -----------------------------------------------------------
const TRIVIA_QUESTIONS=[
  {q:'What is the capital of Japan?',choices:['Seoul','Tokyo','Beijing','Bangkok'],a:1},
  {q:'How many continents are there?',choices:['5','6','7','8'],a:2},
  {q:'What planet is known as the Red Planet?',choices:['Venus','Mars','Jupiter','Saturn'],a:1},
  {q:'Who wrote "Romeo and Juliet"?',choices:['Dickens','Shakespeare','Austen','Hemingway'],a:1},
  {q:'What is the largest ocean on Earth?',choices:['Atlantic','Indian','Arctic','Pacific'],a:3},
  {q:'How many strings does a standard guitar have?',choices:['4','5','6','7'],a:2},
  {q:'What gas do plants absorb from the atmosphere?',choices:['Oxygen','Nitrogen','Carbon dioxide','Hydrogen'],a:2},
  {q:'What is the smallest prime number?',choices:['0','1','2','3'],a:2},
  {q:'Which country invented pizza?',choices:['France','Italy','Greece','Spain'],a:1},
  {q:'What is the hardest natural substance on Earth?',choices:['Gold','Iron','Diamond','Quartz'],a:2},
  {q:'How many legs does a spider have?',choices:['6','8','10','12'],a:1},
  {q:'What is the chemical symbol for gold?',choices:['Go','Gd','Au','Ag'],a:2},
  {q:'Which is the longest river in the world?',choices:['Amazon','Nile','Yangtze','Mississippi'],a:1},
  {q:'What year did the Titanic sink?',choices:['1905','1912','1920','1931'],a:1},
  {q:'How many players are on a standard soccer team on the field?',choices:['9','10','11','12'],a:2},
  {q:'What is the tallest mountain in the world?',choices:['K2','Kilimanjaro','Everest','Denali'],a:2},
  {q:'Which planet has the most moons?',choices:['Earth','Mars','Saturn','Mercury'],a:2},
  {q:'What is the freezing point of water in Celsius?',choices:['-10','0','32','100'],a:1},
  {q:'Who painted the Mona Lisa?',choices:['Van Gogh','Picasso','Da Vinci','Monet'],a:2},
  {q:'What is the currency of Japan?',choices:['Won','Yuan','Yen','Ringgit'],a:2},
  {q:'How many bones are in the adult human body?',choices:['186','206','226','246'],a:1},
  {q:'What is the smallest country in the world?',choices:['Monaco','San Marino','Vatican City','Liechtenstein'],a:2},
  {q:'Which animal is the fastest land animal?',choices:['Lion','Cheetah','Horse','Antelope'],a:1},
  {q:'What language has the most native speakers worldwide?',choices:['English','Spanish','Hindi','Mandarin Chinese'],a:3}
];
function shuffledTriviaOrder(){
  const arr=TRIVIA_QUESTIONS.map((_,i)=>i);
  for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr.slice(0,8); // 8 rounds per game
}
function nextTriviaQuestion(g){
  g.roundIdx++;
  g.answered={};
  g.revealed=false;
}
async function submitTriviaAnswer(msgId,choiceIdx){
  const m=gameMsgOf(msgId); if(!m||!m.game) return;
  const g=m.game;
  if(g.phase!=='playing'||g.revealed||g.roundIdx<0||g.roundIdx>=g.questionOrder.length) return;
  // Participation check: this used to silently add the caller to g.players,
  // so anyone in the conversation who never joined the lobby could answer,
  // land on the final scoreboard and skew the "n/m answered" counter.
  if(!gameHasPlayer(g,me.number)) return;
  if(!(me.number in g.scores)) g.scores[me.number]=0;
  if(me.number in g.answered) return;
  if(!Number.isInteger(choiceIdx)||choiceIdx<0||choiceIdx>3) return;
  g.answered[me.number]=choiceIdx;
  await saveGame();
}
async function revealTriviaAnswer(msgId){
  const m=gameMsgOf(msgId); if(!m||!m.game||m.game.hostId!==me.number) return;
  const g=m.game;
  // Idempotence guard: scoring ran on every call, so a host double-clicking
  // "Reveal answer" (or clicking a stale card that hadn't re-rendered yet)
  // awarded the point twice to everyone who answered correctly.
  if(g.phase!=='playing'||g.revealed||g.roundIdx<0||g.roundIdx>=g.questionOrder.length) return;
  const q=TRIVIA_QUESTIONS[g.questionOrder[g.roundIdx]];
  Object.entries(g.answered).forEach(([num,choice])=>{ if(choice===q.a) g.scores[num]=(g.scores[num]||0)+1; });
  g.revealed=true;
  await saveGame();
}
async function nextTriviaRound(msgId){
  const m=gameMsgOf(msgId); if(!m||!m.game||m.game.hostId!==me.number) return;
  const g=m.game;
  if(g.phase!=='playing') return; // an ended game can't be advanced/revived
  if(g.roundIdx+1>=g.questionOrder.length){ g.phase='ended'; await saveGame(); return; }
  nextTriviaQuestion(g);
  await saveGame();
}
function renderTrivia(game,msgId,body){
  const card=document.createElement('div'); card.className='game-card';
  const scores=game.scores||{};
  const answered=game.answered||{};
  const questionOrder=Array.isArray(game.questionOrder)?game.questionOrder:(game.questionOrder&&typeof game.questionOrder==='object'?Object.values(game.questionOrder):[]);
  const players=Array.isArray(game.players)?game.players:(game.players&&typeof game.players==='object'?Object.values(game.players):[]);
  if(game.phase==='ended'){
    const ranked=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
    card.innerHTML='<div class="game-title">❓ Trivia — Final Scores</div>'
      +ranked.map(([num,score],i)=>'<div style="font-size:12px;padding:2px 0">'+(i===0?'🏆 ':'')+esc(dec((lookupUser(Number(num))||{}).name)||'#'+num)+': '+score+'</div>').join('');
    body.appendChild(card); return;
  }
  const q=TRIVIA_QUESTIONS[questionOrder[game.roundIdx]];
  if(!q){
    const waitMsg=game.roundIdx<0?'Host will start the round soon…':'Loading question…';
    card.innerHTML='<div class="game-title">❓ Trivia</div><div class="game-status">'+waitMsg+'</div>';
    if(game.hostId===me.number&&game.roundIdx<0){
      const sb=document.createElement('button');sb.className='btn btn-sm';sb.textContent='Start game';
      sb.onclick=()=>nextTriviaRound(msgId);
      card.appendChild(sb);
    }
    body.appendChild(card); return;
  }
  card.innerHTML='<div class="game-title">❓ Trivia — Round '+(game.roundIdx+1)+'/'+questionOrder.length+'</div>'
    +'<div class="game-status" style="margin-bottom:8px">'+esc(q.q)+'</div>';
  const myAnswer=answered[me.number];
  q.choices.forEach((choice,idx)=>{
    const btn=document.createElement('button'); btn.className='game-cell'; btn.style.cssText='width:100%;text-align:left;padding:6px 10px;margin-bottom:4px;min-height:auto';
    let label=choice;
    if(game.revealed){
      if(idx===q.a) btn.style.cssText+=';border-color:#2ecc71;color:#2ecc71';
      else if(idx===myAnswer) btn.style.cssText+=';border-color:var(--danger);color:var(--danger)';
    }else if(idx===myAnswer){ btn.style.cssText+=';border-color:var(--accent)'; }
    btn.textContent=label;
    btn.disabled=game.revealed||myAnswer!==undefined;
    btn.onclick=()=>submitTriviaAnswer(msgId,idx);
    card.appendChild(btn);
  });
  const answeredCount=Object.keys(answered).length;
  const sub=document.createElement('div'); sub.style.cssText='font-size:11px;color:var(--muted);margin:4px 0';
  sub.textContent=answeredCount+'/'+players.length+' answered';
  card.appendChild(sub);
  if(game.hostId===me.number){
    const row=document.createElement('div'); row.style.cssText='display:flex;gap:6px';
    if(!game.revealed){ const rb=document.createElement('button'); rb.className='btn btn-sm'; rb.textContent='Reveal answer'; rb.onclick=()=>revealTriviaAnswer(msgId); row.appendChild(rb); }
    else{ const nb=document.createElement('button'); nb.className='btn btn-sm'; nb.textContent=(game.roundIdx+1>=questionOrder.length)?'Finish game':'Next question'; nb.onclick=()=>nextTriviaRound(msgId); row.appendChild(nb); }
    card.appendChild(row);
  }
  body.appendChild(card);
}

// -- Typing Race (live progress via a dedicated Firebase path) -----------------
const RACE_SENTENCES=[
  'The quick brown fox jumps over the lazy dog.',
  'Pack my box with five dozen liquor jugs.',
  'Sphinx of black quartz, judge my vow.',
  'How vexingly quick daft zebras jump.',
  'The five boxing wizards jump quickly.',
  'Bright vixens jump; dozy fowl quack.',
  'Waltz, bad nymph, for quick jigs vex.',
  'Jinxed wizards pluck ivy from the big quilt.'
];
function pickRaceSentence(){ return RACE_SENTENCES[Math.floor(Math.random()*RACE_SENTENCES.length)]; }
function racePath(msgId){ return 'races/'+msgId; }
const _raceListeners={};
function watchRaceProgress(msgId){
  if(_raceListeners[msgId]) return;
  const ref=fbdb.ref(racePath(msgId)+'/progress');
  const handler=ref.on('value',snap=>{
    const val=snap.val()||{};
    Object.entries(val).forEach(([num,pct])=>{
      const bar=document.getElementById('race-bar-'+msgId+'-'+num);
      if(bar) bar.style.width=pct+'%';
    });
  },err=>{ console.warn('typing race listener error',err); });
  _raceListeners[msgId]={ref,handler};
}
// Leaving/switching a conversation used to leave every Typing Race listener
// from it attached forever (they were only detached by rendering that same
// game's "ended" state, which never happens once the chat is closed), so a
// session that visited several races accumulated live Firebase listeners.
// They're re-attached by renderTypingRace whenever the card is on screen.
function cleanupRaceListeners(){
  Object.keys(_raceListeners).forEach(msgId=>{
    const l=_raceListeners[msgId];
    try{ l.ref.off('value',l.handler); }catch(e){}
    delete _raceListeners[msgId];
  });
}
let _raceTypingThrottle=0;
function onRaceInput(msgId,inputEl,sentence){
  const typed=inputEl.value;
  const now=Date.now();
  if(now-_raceTypingThrottle>150){
    _raceTypingThrottle=now;
    const pct=Math.min(100,Math.round(typed.length/sentence.length*100));
    fbdb.ref(racePath(msgId)+'/progress/'+me.number).set(pct);
  }
  if(typed===sentence) finishRace(msgId);
}
async function finishRace(msgId){
  const m=gameMsgOf(msgId); if(!m||!m.game) return;
  const g=m.game;
  // Three guards that were missing, all reachable because the <input>'s
  // oninput closure outlives the state it was rendered from:
  //  - phase: a result could be appended AFTER the host ended the race,
  //    silently rewriting a finished game's leaderboard;
  //  - participation: a spectator who never joined the lobby got a finish
  //    time and could top the results;
  //  - startAt: finishing during the countdown produced a negative time,
  //    which sorts first and "wins" the race.
  if(g.phase!=='racing') return;
  if(!gameHasPlayer(g,me.number)) return;
  if(g.finishTimes[me.number]!=null) return;
  if(!g.startAt||Date.now()<g.startAt) return;
  g.finishTimes[me.number]=Date.now()-g.startAt;
  if(g.players.every(p=>g.finishTimes[p]!=null)) g.phase='ended';
  await saveGame();
}
async function endRaceEarly(msgId){
  const m=gameMsgOf(msgId); if(!m||!m.game||m.game.hostId!==me.number) return;
  if(m.game.phase==='ended') return;
  m.game.phase='ended';
  await saveGame();
}
function renderTypingRace(game,msgId,body){
  const card=document.createElement('div'); card.className='game-card'; card.style.maxWidth='280px';
  if(game.phase==='countdown'){
    const remaining=game.startAt-Date.now();
    if(remaining<=0){ game.phase='racing'; saveGame(); return renderTypingRace(game,msgId,body); }
    card.innerHTML='<div class="game-title">⌨️ Typing Race</div><div class="game-status">Starting in '+Math.ceil(remaining/1000)+'…</div>';
    body.appendChild(card);
    setTimeout(()=>{ const c=convosCache&&activeConvo?convosCache.find(x=>x&&x.key===activeConvo.key):null; if(c){ lastMsgHash=''; renderMessages(c.messages); } }, Math.min(remaining+50,1200));
    return;
  }
  if(game.phase==='ended'){
    if(_raceListeners[msgId]){ try{ _raceListeners[msgId].ref.off('value',_raceListeners[msgId].handler); }catch(e){} delete _raceListeners[msgId]; }
    const ranked=Object.entries(game.finishTimes).sort((a,b)=>a[1]-b[1]);
    card.innerHTML='<div class="game-title">⌨️ Race Results</div>'
      +(ranked.length?ranked.map(([num,ms],i)=>'<div style="font-size:12px;padding:2px 0">'+(i===0?'🏆 ':'')+esc(dec((lookupUser(Number(num))||{}).name)||'#'+num)+': '+(ms/1000).toFixed(2)+'s</div>').join(''):'<div class="dash-widget-empty">No one finished.</div>');
    body.appendChild(card); return;
  }
  card.innerHTML='<div class="game-title">⌨️ Typing Race</div><div class="game-status" style="font-family:monospace;font-size:12px;line-height:1.5;margin-bottom:8px">'+esc(game.sentence)+'</div>';
  const finished=game.finishTimes[me.number]!=null;
  if(!finished){
    const input=document.createElement('input'); input.type='text'; input.placeholder='Type it here…'; input.autocomplete='off';
    input.oninput=()=>onRaceInput(msgId,input,game.sentence);
    card.appendChild(input);
  }else{
    const done=document.createElement('div'); done.style.cssText='font-size:12px;color:#2ecc71;margin:4px 0'; done.textContent='✅ Finished in '+(game.finishTimes[me.number]/1000).toFixed(2)+'s — waiting on others…';
    card.appendChild(done);
  }
  const barsWrap=document.createElement('div'); barsWrap.style.cssText='margin-top:8px';
  game.players.forEach(p=>{
    const row=document.createElement('div'); row.style.cssText='margin-bottom:4px';
    row.innerHTML='<div style="font-size:10px;color:var(--muted);margin-bottom:2px">'+esc(dec((lookupUser(p)||{}).name)||'#'+p)+'</div><div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden"><div id="race-bar-'+msgId+'-'+p+'" style="height:100%;width:0%;background:var(--accent);transition:width .15s"></div></div>';
    barsWrap.appendChild(row);
  });
  card.appendChild(barsWrap);
  if(game.hostId===me.number){
    const eb=document.createElement('button'); eb.className='btn btn-ghost btn-sm'; eb.style.marginTop='8px'; eb.textContent='End race'; eb.onclick=()=>endRaceEarly(msgId);
    card.appendChild(eb);
  }
  body.appendChild(card);
  watchRaceProgress(msgId);
}

// -- Werewolf (simplified: villager / werewolf / seer roles) -------------------
// Honest scope: discussion happens in normal chat, not tracked by the game;
// phases advance when the host taps a button rather than on a timer; and
// "hidden" info (your role, night actions) is hidden by not rendering it to
// anyone but the right player — same client-side trust model as the rest of
// this app, not cryptographically secret from someone in devtools.
function assignWerewolfRoles(g){
  const players=[...g.players];
  const wolfCount=Math.max(1,Math.floor(players.length/4));
  const shuffled=[...players];
  for(let i=shuffled.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  const wolves=shuffled.slice(0,wolfCount);
  const seer=shuffled[wolfCount];
  g.roles={};
  players.forEach(p=>{ g.roles[p]=wolves.includes(p)?'werewolf':(p===seer?'seer':'villager'); });
  g.alive={}; players.forEach(p=>g.alive[p]=true);
}
function werewolfAliveList(g){ const pl=Array.isArray(g.players)?g.players:(g.players&&typeof g.players==='object'?Object.values(g.players):[]); const al=g.alive||{}; return pl.filter(p=>al[p]); }
function werewolfCheckWin(g){
  const alive=werewolfAliveList(g);
  const wolvesAlive=alive.filter(p=>g.roles[p]==='werewolf').length;
  const othersAlive=alive.length-wolvesAlive;
  if(wolvesAlive===0) return 'village';
  if(wolvesAlive>=othersAlive) return 'wolves';
  return null;
}
async function werewolfNightAction(msgId,targetNum){
  const m=gameMsgOf(msgId); if(!m||!m.game||m.game.phase!=='night') return;
  const g=m.game;
  if(!gameHasPlayer(g,me.number)||!g.alive[me.number]) return;
  // Target must be another living player in this game — an arbitrary number
  // (a stale card, a hand-called handler) otherwise skewed the kill vote or
  // asked the Seer about a role that doesn't exist.
  if(!gameHasPlayer(g,targetNum)||!g.alive[targetNum]||targetNum===me.number) return;
  const myRole=g.roles[me.number];
  // One night action per player per night. Without this a Seer could keep
  // re-investigating (the single seerCheck slot is overwritten) and learn
  // every role in one night from a card that hadn't re-rendered yet.
  if(myRole==='werewolf'){
    if(me.number in g.night.wolfTargets) return;
    g.night.wolfTargets[me.number]=targetNum;
  }
  else if(myRole==='seer'){
    if(g.night.seerCheck&&g.night.seerCheck.by===me.number) return;
    g.night.seerCheck={by:me.number,target:targetNum,result:g.roles[targetNum]};
  }
  else return; // villagers have no night action
  await saveGame();
}
async function werewolfResolveNight(msgId){
  const m=gameMsgOf(msgId); if(!m||!m.game||m.game.hostId!==me.number||m.game.phase!=='night') return;
  const g=m.game;
  const votes=Object.values(g.night.wolfTargets);
  let killed=null;
  if(votes.length){
    const counts={}; votes.forEach(v=>counts[v]=(counts[v]||0)+1);
    killed=Number(Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]);
  }
  if(killed!=null&&g.alive[killed]){ g.alive[killed]=false; g.log.push((dec((lookupUser(killed)||{}).name)||'#'+killed)+' was found dead. 🌙'); }
  else{ g.log.push('No one died last night.'); }
  const winner=werewolfCheckWin(g);
  if(winner){ g.winner=winner; g.phase='ended'; g.log.push(winner==='village'?'🎉 The village wins!':'🐺 The werewolves win!'); }
  else{ g.phase='day'; g.day={votes:{}}; }
  await saveGame();
}
async function werewolfVote(msgId,targetNum){
  const m=gameMsgOf(msgId); if(!m||!m.game||m.game.phase!=='day') return;
  const g=m.game;
  if(!gameHasPlayer(g,me.number)||!g.alive[me.number]) return;
  if(!gameHasPlayer(g,targetNum)||!g.alive[targetNum]||targetNum===me.number) return;
  if(me.number in g.day.votes) return; // votes are final, one per living player
  g.day.votes[me.number]=targetNum;
  await saveGame();
}
async function werewolfResolveDay(msgId){
  const m=gameMsgOf(msgId); if(!m||!m.game||m.game.hostId!==me.number||m.game.phase!=='day') return;
  const g=m.game;
  const votes=Object.values(g.day.votes);
  let eliminated=null;
  if(votes.length){
    const counts={}; votes.forEach(v=>counts[v]=(counts[v]||0)+1);
    eliminated=Number(Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]);
  }
  if(eliminated!=null&&g.alive[eliminated]){
    g.alive[eliminated]=false;
    g.log.push((dec((lookupUser(eliminated)||{}).name)||'#'+eliminated)+' was voted out — they were a '+g.roles[eliminated]+'. ☀️');
  }else{ g.log.push('No one was voted out.'); }
  const winner=werewolfCheckWin(g);
  if(winner){ g.winner=winner; g.phase='ended'; g.log.push(winner==='village'?'🎉 The village wins!':'🐺 The werewolves win!'); }
  else{ g.round++; g.phase='night'; g.night={wolfTargets:{},seerCheck:null}; g.log.push('Round '+g.round+' — night falls.'); }
  await saveGame();
}
function renderWerewolf(game,msgId,body){
  const card=document.createElement('div'); card.className='game-card'; card.style.maxWidth='260px';
  const roles=game.roles||{};
  const alive=game.alive||{};
  const players=Array.isArray(game.players)?game.players:(game.players&&typeof game.players==='object'?Object.values(game.players):[]);
  const log=Array.isArray(game.log)?game.log:(game.log&&typeof game.log==='object'?Object.values(game.log):[]);
  if(game.phase==='ended'){
    card.innerHTML='<div class="game-title">🐺 Werewolf — Game Over</div><div class="game-status">'+(game.winner==='village'?'🎉 Village wins!':'🐺 Werewolves win!')+'</div>'
      +'<div style="font-size:11px;color:var(--muted);margin-top:6px">'+log.slice(-4).map(l=>esc(l)).join('<br>')+'</div>'
      +'<div style="font-size:11px;margin-top:8px">'+players.map(p=>esc(dec((lookupUser(p)||{}).name)||'#'+p)+' — '+roles[p]).join('<br>')+'</div>';
    body.appendChild(card); return;
  }
  const aliveList=werewolfAliveList(game);
  const myRole=roles[me.number];
  const iAmAlive=alive[me.number];
  card.innerHTML='<div class="game-title">🐺 Werewolf — Round '+game.round+' ('+(game.phase==='night'?'Night 🌙':'Day ☀️')+')</div>';
  if(myRole){
    const roleLine=document.createElement('div'); roleLine.style.cssText='font-size:11px;color:var(--muted);margin-bottom:6px';
    roleLine.textContent=iAmAlive?('You are a '+myRole+'.'):('You died. Spectating as a '+myRole+'.');
    card.appendChild(roleLine);
    if(myRole==='werewolf'&&iAmAlive){
      const others=aliveList.filter(p=>roles[p]==='werewolf'&&p!==me.number);
      if(others.length){ const wl=document.createElement('div'); wl.style.cssText='font-size:11px;color:var(--muted);margin-bottom:6px'; wl.textContent='Fellow wolves: '+others.map(p=>dec((lookupUser(p)||{}).name)||'#'+p).join(', '); card.appendChild(wl); }
    }
  }
  const logBox=document.createElement('div'); logBox.style.cssText='font-size:10px;color:var(--muted);margin-bottom:8px;max-height:60px;overflow-y:auto';
  logBox.innerHTML=log.slice(-4).map(l=>esc(l)).join('<br>');
  card.appendChild(logBox);
  if(iAmAlive&&game.phase==='night'&&(myRole==='werewolf'||myRole==='seer')){
    const targets=aliveList.filter(p=>p!==me.number);
    const alreadyActed=myRole==='werewolf'?(me.number in game.night.wolfTargets):(game.night.seerCheck&&game.night.seerCheck.by===me.number);
    if(!alreadyActed){
      const label=document.createElement('div'); label.style.cssText='font-size:11px;margin-bottom:4px'; label.textContent=myRole==='werewolf'?'Pick someone to eliminate:':'Pick someone to investigate:';
      card.appendChild(label);
      targets.forEach(p=>{
        const btn=document.createElement('button'); btn.className='game-cell'; btn.style.cssText='width:100%;text-align:left;padding:5px 8px;margin-bottom:3px;min-height:auto';
        btn.textContent=dec((lookupUser(p)||{}).name)||'#'+p;
        btn.onclick=()=>werewolfNightAction(msgId,p);
        card.appendChild(btn);
      });
    }else if(myRole==='seer'&&game.night.seerCheck&&game.night.seerCheck.by===me.number){
      const r=document.createElement('div'); r.style.cssText='font-size:11px;color:var(--accent);margin-top:4px';
      r.textContent=(dec((lookupUser(game.night.seerCheck.target)||{}).name)||'#'+game.night.seerCheck.target)+' is a '+game.night.seerCheck.result+'.';
      card.appendChild(r);
    }else{
      const w=document.createElement('div'); w.style.cssText='font-size:11px;color:var(--muted)'; w.textContent='Waiting on others…';
      card.appendChild(w);
    }
  }
  if(iAmAlive&&game.phase==='day'){
    const myVote=game.day.votes[me.number];
    if(myVote==null){
      const label=document.createElement('div'); label.style.cssText='font-size:11px;margin-bottom:4px'; label.textContent='Vote to eliminate:';
      card.appendChild(label);
      aliveList.filter(p=>p!==me.number).forEach(p=>{
        const btn=document.createElement('button'); btn.className='game-cell'; btn.style.cssText='width:100%;text-align:left;padding:5px 8px;margin-bottom:3px;min-height:auto';
        btn.textContent=dec((lookupUser(p)||{}).name)||'#'+p;
        btn.onclick=()=>werewolfVote(msgId,p);
        card.appendChild(btn);
      });
    }else{
      const w=document.createElement('div'); w.style.cssText='font-size:11px;color:var(--muted)'; w.textContent='You voted for '+(dec((lookupUser(myVote)||{}).name)||'#'+myVote)+'. Waiting on others…';
      card.appendChild(w);
    }
  }
  if(game.hostId===me.number){
    const row=document.createElement('div'); row.style.cssText='margin-top:6px';
    if(game.phase==='night'){ const rb=document.createElement('button'); rb.className='btn btn-sm btn-ghost'; rb.textContent='Resolve night'; rb.onclick=()=>werewolfResolveNight(msgId); row.appendChild(rb); }
    else{ const rb=document.createElement('button'); rb.className='btn btn-sm btn-ghost'; rb.textContent='Resolve vote'; rb.onclick=()=>werewolfResolveDay(msgId); row.appendChild(rb); }
    card.appendChild(row);
  }
  body.appendChild(card);
}

// -- MESSAGE SEARCH -------------------------------------------------------
function onSearchInput(q){
  searchQ=q;
  if(!q||q.length<2){
    renderSidebar();
    document.getElementById('search-results').style.display='none';
    return;
  }
  // Search both contact names and message content
  const results=[];
  if(convosCache&&me){
    convosCache.forEach(conv=>{
      // A locked chat's plaintext must never surface anywhere it's not
      // gated behind the PIN/Face prompt — search results included.
      if(lockedChats[conv.key]) return;
      const myContacts=contacts.filter(c=>c&&c.key===conv.key);
      const contactName=myContacts.length?myContacts[0].name:'';
      (conv.messages||[]).forEach(m=>{
        const txt=msgText(m);
        if(txt.toLowerCase().includes(q.toLowerCase())){
          results.push({convKey:conv.key,convName:contactName||conv.key,msg:m,txt});
        }
      });
    });
  }
  renderSearchResults(results,q);
}
function renderSearchResults(results,q){
  const wrap=document.getElementById('search-results');
  if(!results.length){wrap.style.display='none';renderSidebar();return;}
  wrap.style.display='block';
  wrap.innerHTML='';
  const label=document.createElement('div');label.style.cssText='padding:6px 12px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.7px;border-bottom:1px solid var(--border)';label.textContent=results.length+' message'+(results.length!==1?'s':'');wrap.appendChild(label);
  results.slice(0,20).forEach(r=>{
    const item=document.createElement('div');item.className='search-result-item';
    const _rq=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const highlighted=esc(r.txt).replace(new RegExp(_rq,'gi'),m=>`<mark>${m}</mark>`);
    item.innerHTML=`<div class="search-result-chat">${esc(r.convName)} <span class="search-result-time">${fmtTime(r.msg.time)}</span></div><div class="search-result-text">${highlighted}</div>`;
    item.onclick=()=>{
      wrap.style.display='none';
      document.getElementById('sb-search-input').value='';
      // Open the convo and scroll to message
      const c=contacts.find(x=>x&&x.key===r.convKey);
      if(c){openChat(c).then(()=>scrollToMessage(r.msg.id));}
    };
    wrap.appendChild(item);
  });
}
function scrollToMessage(msgId){
  setTimeout(()=>{
    const wrap=document.getElementById('messages-wrap');
    const rows=wrap.querySelectorAll('.msg-row');
    rows.forEach(row=>{if(row.dataset.msgId===msgId){row.scrollIntoView({behavior:'smooth',block:'center'});row.style.background='rgba(107,93,232,0.2)';setTimeout(()=>{row.style.background='';},1500);}});
  },400);
}

