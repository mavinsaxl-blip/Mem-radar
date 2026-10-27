import express from 'express';
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.use(express.json({limit:'64kb'}));
const allowedChains = new Set(['solana','base','bsc']);
const RPCS = {
  solana: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'
};
async function getJson(url, opts={}) {
  const r = await fetch(url, {headers:{'accept':'application/json','user-agent':'MemeRadar/0.2',...(opts.headers||{})},...opts});
  if (!r.ok) throw new Error(`Provider returned HTTP ${r.status}`);
  return r.json();
}
async function rpc(chain, method, params=[]) {
  const r = await fetch(RPCS[chain], {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const j=await r.json(); if(!r.ok || j.error) throw new Error(j.error?.message || `RPC HTTP ${r.status}`); return j.result;
}
app.get('/api/status', (_req,res)=>res.json({app:'MEME RADAR',version:'0.2.0',marketData:'DEX Screener public API',x:process.env.X_BEARER_TOKEN?'configured':'not configured',onchain:{solana:!!process.env.SOLANA_RPC_URL?'custom RPC':'public RPC (rate-limited)',base:!!process.env.BASE_RPC_URL?'custom RPC':'public RPC (rate-limited)',bsc:!!process.env.BSC_RPC_URL?'custom RPC':'public RPC (rate-limited)'},paperTrading:'browser-local only',execution:'disabled'}));
app.get('/api/boosts', async (_req,res)=>{try{const data=await getJson('https://api.dexscreener.com/token-boosts/latest/v1');res.json({source:'live',updatedAt:new Date().toISOString(),items:(Array.isArray(data)?data:[]).filter(x=>allowedChains.has(String(x.chainId||'').toLowerCase())).slice(0,100)});}catch(e){res.status(502).json({source:'unavailable',error:e.message,items:[]});}});
app.get('/api/profiles', async (_req,res)=>{try{const data=await getJson('https://api.dexscreener.com/token-profiles/latest/v1');res.json({source:'live',updatedAt:new Date().toISOString(),items:(Array.isArray(data)?data:[]).filter(x=>allowedChains.has(String(x.chainId||'').toLowerCase())).slice(0,100)});}catch(e){res.status(502).json({source:'unavailable',error:e.message,items:[]});}});
// Fast early-launch candidate scan. Uses DEX Screener's latest profile/boost discovery
// plus indexed token-pair snapshots; this is NOT a guaranteed all-pairs stream.
app.get('/api/early-launches', async (_req,res)=>{
 try {
  const networks={solana:'solana',base:'base',bsc:'bsc'};
  const geckoResults=await Promise.allSettled(Object.entries(networks).map(async ([chain,network])=>({chain,data:await getJson(`https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?page=1`)})));
  const geckoPools=[];
  for(const r of geckoResults) if(r.status==='fulfilled') for(const pool of (r.value.data?.data||[])) geckoPools.push({chain:r.value.chain,pool});
  const [profilesResult,boostsResult]=await Promise.allSettled([
   getJson('https://api.dexscreener.com/token-profiles/latest/v1'),
   getJson('https://api.dexscreener.com/token-boosts/latest/v1')
  ]);
  const seeds=[];
  for(const r of [profilesResult,boostsResult]) if(r.status==='fulfilled'&&Array.isArray(r.value)) seeds.push(...r.value);
  const providerCount=geckoResults.filter(r=>r.status==='fulfilled').length+[profilesResult,boostsResult].filter(r=>r.status==='fulfilled').length;
  if(providerCount===0) return res.status(502).json({source:'unavailable',error:'All free discovery providers failed or rate-limited this request.',candidates:[]});
  const uniq=new Map();
  for(const x of seeds){const chain=String(x.chainId||'').toLowerCase(),address=String(x.tokenAddress||'');if(allowedChains.has(chain)&&address&&address.length<100)uniq.set(chain+':'+address,{chain,address,description:x.description||'',url:x.url||'',icon:x.icon||null,boosted:Boolean(x.totalAmount||x.amount)});}
  const selected=[...uniq.values()].slice(0,36);
  const results=[];let cursor=0;
  async function worker(){while(cursor<selected.length){const i=cursor++,seed=selected[i];try{const pairs=await getJson(`https://api.dexscreener.com/token-pairs/v1/${seed.chain}/${encodeURIComponent(seed.address)}`);if(Array.isArray(pairs)){for(const pair of pairs)results.push({...pair,_seed:seed});}}catch{}}
  }
  await Promise.all(Array.from({length:6},worker));
  const now=Date.now();
  const byToken=new Map();
  for(const p of results){const seed=p._seed||{};const chain=String(p.chainId||seed.chain||'').toLowerCase();if(!allowedChains.has(chain))continue;const addr=p.baseToken?.address||seed.address;const key=chain+':'+addr;const prev=byToken.get(key);if(!prev||(p.liquidity?.usd||0)>(prev.liquidity?.usd||0))byToken.set(key,p);}
  for(const item of geckoPools){
   const a=item.pool?.attributes||{}, rel=item.pool?.relationships||{};
   const baseId=rel.base_token?.data?.id||'', baseAddress=baseId.includes('_')?baseId.slice(baseId.indexOf('_')+1):'';
   const quoteId=rel.quote_token?.data?.id||'', quoteAddress=quoteId.includes('_')?quoteId.slice(quoteId.indexOf('_')+1):'';
   const tx=a.transactions||{}, vol=a.volume_usd||{}, change=a.price_change_percentage||{};
   const t5=tx.m5||{}, t1=tx.h1||{};
   const created=a.pool_created_at?Date.parse(a.pool_created_at):0;
   const synthetic={chainId:item.chain, pairAddress:a.address||item.pool?.id?.split('_').slice(1).join('_'),baseToken:{address:baseAddress,name:a.name||'New pool',symbol:(a.name||'POOL').split(' / ')[0]},quoteToken:{address:quoteAddress},url:`https://www.geckoterminal.com/${item.chain}/pools/${a.address||''}`,priceUsd:a.base_token_price_usd||null,marketCap:null,fdv:a.fdv_usd?Number(a.fdv_usd):null,liquidity:{usd:Number(a.reserve_in_usd||0)},volume:{m5:Number(vol.m5||0),h1:Number(vol.h1||0),h24:Number(vol.h24||0)},priceChange:{m5:Number(change.m5||0),h1:Number(change.h1||0)},txns:{m5:{buys:Number(t5.buys||0),sells:Number(t5.sells||0)}},pairCreatedAt:created||null,_gecko:true};
   if(baseAddress){const key=item.chain+':'+baseAddress;const prev=byToken.get(key);if(!prev||(synthetic.liquidity.usd>(prev.liquidity?.usd||0)))byToken.set(key,synthetic);}
  }
  const candidates=[...byToken.values()].map(p=>{
   const created=Number(p.pairCreatedAt||0),ageMin=created?Math.max(0,(now-created)/60000):null;
   const liq=Number(p.liquidity?.usd||0),vol5=Number(p.volume?.m5||0),vol1=Number(p.volume?.h1||0),vol24=Number(p.volume?.h24||0);
   const buys=Number(p.txns?.m5?.buys||0),sells=Number(p.txns?.m5?.sells||0),ch5=Number(p.priceChange?.m5||0),ch1=Number(p.priceChange?.h1||0);
   const buyRatio=(buys+sells)>0?buys/(buys+sells):null,volLiq=liq>0?vol5/liq:0;
   let score=0;const reasons=[],warnings=[];
   if(ageMin!==null&&ageMin<=5){score+=25;reasons.push('Pair age ≤5m');}else if(ageMin!==null&&ageMin<=30){score+=17;reasons.push('Pair age ≤30m');}else if(ageMin!==null&&ageMin<=180){score+=8;}
   if(liq>=10000){score+=15;reasons.push('Liquidity ≥$10k');}else if(liq>=3000){score+=8;reasons.push('Liquidity ≥$3k');}else{score-=18;warnings.push('Thin liquidity: exit/slippage risk');}
   if(buys+sells>=20&&buyRatio!==null&&buyRatio>=0.65){score+=18;reasons.push('Buy-heavy 5m flow');}else if(buys+sells>=8&&buyRatio!==null&&buyRatio>=0.58){score+=9;reasons.push('Buy-side activity');}
   if(vol5>=1000&&volLiq>=0.08){score+=12;reasons.push('5m volume vs liquidity rising');}
   if(ch5>=5&&ch5<=45){score+=12;reasons.push('Positive 5m momentum');}else if(ch5>80){score+=3;warnings.push('Very sharp 5m pump / chase risk');}else if(ch5< -15){score-=15;warnings.push('Negative 5m momentum');}
   if(sells>=Math.max(10,buys*1.5)){score-=18;warnings.push('Sell pressure exceeds buys');}
   if(liq>0&&vol24/liq>20){score-=8;warnings.push('Extreme 24h volume/liquidity ratio');}
   score=Math.max(0,Math.min(100,score));
   let signal=score>=62&&liq>=3000&&!(sells>=Math.max(10,buys*1.5))?'EARLY RUNNER WATCH':score>=38?'WATCHLIST':'LOW SIGNAL / RISK';
   if(ageMin===null)warnings.push('Pair age unavailable');
   return {chainId:String(p.chainId||p._seed?.chain||'').toLowerCase(),pairAddress:p.pairAddress||null,baseToken:p.baseToken,quoteToken:p.quoteToken,url:p.url||p._seed?.url||null,priceUsd:p.priceUsd||null,marketCap:p.marketCap??p.fdv??null,liquidity:liq,volume5m:vol5,volume1h:vol1,volume24h:vol24,change5m:ch5,change1h:ch1,buys5m:buys,sells5m:sells,buyRatio:buyRatio===null?null:Math.round(buyRatio*100),pairCreatedAt:created||null,ageMinutes:ageMin===null?null:Math.round(ageMin*10)/10,score,signal,reasons,warnings,boosted:Boolean(p._seed?.boosted),source:'live'};
  }).sort((a,b)=>b.score-a.score).slice(0,50);
  res.json({source:'live',provider:'DEX Screener public API',updatedAt:new Date().toISOString(),discovery:'GeckoTerminal new-pool snapshots plus DEX Screener latest profiles/boosts and token-pair snapshots; public API limits apply, not a websocket stream.',candidateCount:candidates.length,candidates});
 }catch(e){res.status(502).json({source:'unavailable',error:e.message,candidates:[]});}
});

app.get('/api/search', async (req,res)=>{const q=String(req.query.q||'SOL').slice(0,100);try{const data=await getJson('https://api.dexscreener.com/latest/dex/search?q='+encodeURIComponent(q));const pairs=(data.pairs||[]).filter(p=>allowedChains.has(String(p.chainId||'').toLowerCase()));res.json({source:'live',updatedAt:new Date().toISOString(),pairs:pairs.slice(0,100)});}catch(e){res.status(502).json({source:'unavailable',error:e.message,pairs:[]});}});
app.get('/api/token-pairs', async (req,res)=>{const chain=String(req.query.chain||'').toLowerCase(),address=String(req.query.address||'');if(!allowedChains.has(chain)||!address||address.length>100)return res.status(400).json({error:'Valid chain and token address required'});try{const pairs=await getJson(`https://api.dexscreener.com/token-pairs/v1/${chain}/${encodeURIComponent(address)}`);res.json({source:'live',updatedAt:new Date().toISOString(),pairs:Array.isArray(pairs)?pairs:[]});}catch(e){res.status(502).json({source:'unavailable',error:e.message,pairs:[]});}});
app.get('/api/risk', async (req,res)=>{
 const chain=String(req.query.chain||'').toLowerCase(), address=String(req.query.address||'').trim();
 if(!allowedChains.has(chain)||!address||address.length>100)return res.status(400).json({error:'Provide chain=solana|base|bsc and a token address'});
 try{
  const [pairsResult,chainResult]=await Promise.allSettled([
   getJson(`https://api.dexscreener.com/token-pairs/v1/${chain}/${encodeURIComponent(address)}`),
   chain==='solana'?rpc(chain,'getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]):rpc(chain,'eth_call',[{to:address,data:'0x8da5cb5b'},'latest'])
  ]);
  const pairs=pairsResult.status==='fulfilled'&&Array.isArray(pairsResult.value)?pairsResult.value:[];
  const pair=[...pairs].sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0]||null;
  const flags=[];let score=35;
  const liq=Number(pair?.liquidity?.usd||0), vol=Number(pair?.volume?.h24||0), ch5=Number(pair?.priceChange?.m5||0), ch1=Number(pair?.priceChange?.h1||0), tx5=(pair?.txns?.m5?.buys||0)+(pair?.txns?.m5?.sells||0);
  if(!pair){flags.push({level:'unknown',text:'No indexed DEX pair found for this address; market checks unavailable.'});}
  else {score+=Math.min(15,Math.log10(Math.max(1,liq))*2); if(liq<3000){score-=25;flags.push({level:'high',text:'Very low reported liquidity (< $3,000); exits may be costly or impossible.'});}else if(liq<10000){score-=10;flags.push({level:'medium',text:'Thin liquidity (< $10,000); slippage and exit risk are elevated.'});}else flags.push({level:'positive',text:'Reported liquidity is above $10,000; this does not prove it is locked.'});
   if(vol>0&&liq>0&&vol/liq>12){score-=8;flags.push({level:'medium',text:'24h volume is unusually high relative to liquidity; investigate wash trading or rapid turnover.'});}
   if(ch5>60||ch1>150){score-=10;flags.push({level:'medium',text:'Sharp recent price acceleration; possible late-entry/overextension risk.'});}
   if(ch5< -25||ch1< -50){score-=20;flags.push({level:'high',text:'Severe recent drawdown; momentum may be collapsing.'});}
   const sells=Number(pair?.txns?.m5?.sells||0),buys=Number(pair?.txns?.m5?.buys||0);if(sells>buys*2&&sells>=10){score-=12;flags.push({level:'medium',text:'Recent sell count is more than twice buy count; monitor exit pressure.'});}
   if((pair?.pairCreatedAt)&&Date.now()-pair.pairCreatedAt<60*60*1000){flags.push({level:'medium',text:'Pool is less than one hour old; launch-stage data and liquidity can change quickly.'});}
  }
  let authority=null;
  if(chainResult.status==='fulfilled'){
   if(chain==='solana'){
    const value=chainResult.value?.value; if(!value){flags.push({level:'high',text:'Solana RPC reports no account at this address.'});score-=20;} else {try{const raw=Buffer.from(value.data?.[0]||'','base64');if(raw.length>=82){const mintOpt=raw.readUInt32LE(0),freezeOpt=raw.readUInt32LE(46);authority={mintAuthorityPresent:mintOpt!==0,freezeAuthorityPresent:freezeOpt!==0,decimals:raw[44],initialized:raw[45]===1};if(mintOpt!==0){score-=12;flags.push({level:'high',text:'Mint authority appears present; supply may be expandable.'});}else flags.push({level:'positive',text:'Mint authority appears disabled in the parsed SPL mint account.'});if(freezeOpt!==0){score-=12;flags.push({level:'high',text:'Freeze authority appears present; token accounts may be freezeable.'});}else flags.push({level:'positive',text:'Freeze authority appears disabled in the parsed SPL mint account.'});}else flags.push({level:'unknown',text:'Account data is not a standard SPL mint layout; authority checks skipped.'});}catch{flags.push({level:'unknown',text:'Could not parse mint account data.'});}}
   } else {const result=String(chainResult.value||'');authority={ownerCallResult:result,interpretation:'An owner() response is not a complete rug check; many tokens do not implement this method.'};if(/^0x0{64}$/i.test(result))flags.push({level:'positive',text:'owner() returned zero address (if contract implements standard Ownable); not proof of safety.'});else flags.push({level:'unknown',text:'EVM owner() call returned data or reverted; ownership status needs contract-specific verification.'});}
  } else flags.push({level:'unknown',text:`Chain RPC check unavailable: ${chainResult.reason?.message||'provider error'}`});
  if(!pair)score=0; score=Math.max(0,Math.min(100,Math.round(score)));
  res.json({source:'live',chain,address,updatedAt:new Date().toISOString(),riskScore:score,riskLabel:score<35?'HIGH RISK / INSUFFICIENT DATA':score<60?'CAUTION':score<78?'MODERATE SCREEN':'LOWER OBSERVED RISK — NOT SAFE',pair:pair?{url:pair.url,baseToken:pair.baseToken,priceUsd:pair.priceUsd,marketCap:pair.marketCap??pair.fdv,liquidity:liq,volume24h:vol,change5m:ch5,change1h:ch1,buys5m:pair.txns?.m5?.buys,sells5m:pair.txns?.m5?.sells,pairCreatedAt:pair.pairCreatedAt}:null,authority,flags,limitations:['This is a preliminary screen, not an audit or honeypot guarantee.','DEX data does not prove liquidity is locked or holders are independent.','Top-holder concentration, wallet clusters, deployer sales and sell simulation are not fully indexed here.','EVM owner() is contract-specific; mint/freeze authority checks here are Solana SPL mint checks only.']});
 }catch(e){res.status(502).json({source:'unavailable',error:e.message});}
});
app.get('/api/wallet-check',async(req,res)=>{const chain=String(req.query.chain||'').toLowerCase(),address=String(req.query.address||'').trim();if(!allowedChains.has(chain)||!address||address.length>100)return res.status(400).json({error:'Valid chain and wallet address required'});try{let result;if(chain==='solana'){result=await rpc(chain,'getSignaturesForAddress',[address,{limit:10}]);res.json({source:'live',chain,address,checkedAt:new Date().toISOString(),activity:result.map(x=>({signature:x.signature,blockTime:x.blockTime?new Date(x.blockTime*1000).toISOString():null,slot:x.slot,err:x.err})),note:'Recent address signatures only. This endpoint does not decode swaps or label the wallet as smart money.'});}else{const [balance,nonce]=await Promise.all([rpc(chain,'eth_getBalance',[address,'latest']),rpc(chain,'eth_getTransactionCount',[address,'latest'])]);res.json({source:'live',chain,address,checkedAt:new Date().toISOString(),nativeBalanceWei:balance,transactionCount:parseInt(nonce,16),note:'Standard public RPC exposes native balance and nonce only; historical token swaps require an indexer. No smart-wallet label is inferred.'});}}catch(e){res.status(502).json({source:'unavailable',error:e.message,note:'Public RPC may be rate-limited. Configure your own free-tier RPC URL if needed.'});}});
app.get('/api/x-status', (_req,res)=>res.json({configured:Boolean(process.env.X_BEARER_TOKEN),note:'X recent-search API requires a developer account and may incur charges. No token means no live X data.'}));
app.get('/api/x-search', async (req,res)=>{if(!process.env.X_BEARER_TOKEN)return res.status(503).json({source:'unavailable',error:'X_BEARER_TOKEN is not configured. X feed is disabled, not simulated.'});const q=String(req.query.q||'(solana OR memecoin) -is:retweet').slice(0,400);try{const u='https://api.x.com/2/tweets/search/recent?max_results=25&tweet.fields=created_at,public_metrics,author_id&query='+encodeURIComponent(q);const r=await fetch(u,{headers:{Authorization:`Bearer ${process.env.X_BEARER_TOKEN}`}});const body=await r.json();if(!r.ok)return res.status(r.status).json({source:'unavailable',error:body?.detail||body?.title||'X API request failed'});res.json({source:'live',updatedAt:new Date().toISOString(),data:body.data||[],includes:body.includes||{}});}catch(e){res.status(502).json({source:'unavailable',error:e.message});}});
app.listen(PORT,()=>console.log(`MEME RADAR v0.2 running at http://localhost:${PORT}`));
