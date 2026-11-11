import express from 'express';

const allowedPaths=new Set(['/v3/log/init','/v3/place/text','/v3/place/around','/v3/place/detail','/v5/place/text','/v5/place/around','/v5/place/detail','/v3/assistant/inputtips','/v3/geocode/geo','/v3/geocode/regeo','/v3/config/district','/v3/direction/walking','/v3/direction/driving','/v3/direction/transit/integrated','/v4/direction/bicycling','/v5/direction/walking','/v5/direction/driving','/v5/direction/bicycling','/v5/direction/transit/integrated','/v3/assistant/coordinate/convert','/v3/staticmap']);
// Static map images for board widgets: binary, cacheable, rate-limited apart from search.
const STATIC_PATH='/v3/staticmap',STATIC_MAX_BYTES=2_000_000,STATIC_PER_MINUTE=240;
const safeParamName=/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/;
const blockedParams=new Set(['jscode','securityJsCode','sig','signature','secret','token','auth','url','uri','href','src','redirect','target','domain','host','hostname','origin_url','callback_url','webhook','__proto__','constructor','prototype']);
export function createAmapRouter(config) {
 const router=express.Router(),hits=new Map(),staticHits=new Map();
 router.get(/.*/,async(req,res)=>{
   const key=config.amapKey||config.amap?.key;
   const secret=config.amapSecurityJsCode||config.amap?.securityJsCode;
   if(!key||!secret)return res.status(503).json({error:{code:'MAP_UNAVAILABLE',message:'地图暂时无法载入，请稍后重试'}});
   if(!allowedPaths.has(req.path))return res.status(404).json({error:{code:'MAP_PATH',message:'地图请求不受支持'}});
   const actor=req.user?.id||req.session?.userId||req.ip;
   const isStatic=req.path===STATIC_PATH,table=isStatic?staticHits:hits;
   const now=Date.now(),old=table.get(actor);
   const bucket=!old||now-old.start>60000?{start:now,count:0}:old;bucket.count++;table.set(actor,bucket);
   if(table.size>5000)for(const[k,v]of table)if(now-v.start>60000)table.delete(k);
   if(bucket.count>(isStatic?STATIC_PER_MINUTE:120))return res.status(429).json({error:{code:'MAP_RATE_LIMIT',message:'地图查询较频繁，请稍后重试'}});
   const target=new URL(req.path,'https://restapi.amap.com');
   for(const[k,raw]of Object.entries(req.query)){
     // JSAPI repeats the identical s=... SDK parameter on some service calls.
     const v=Array.isArray(raw)&&raw.every(x=>x===raw[0])?raw[0]:raw;
     if(!safeParamName.test(k)||blockedParams.has(k)||typeof v!=='string'||v.length>3000||/[\0\r\n]/.test(v))return res.status(400).json({error:{code:'MAP_PARAMETERS',message:'地图查询参数无效'}});
     if(k==='callback'&&!/^[A-Za-z_$][0-9A-Za-z_$.]{0,127}$/.test(v))return res.status(400).end();
     if(k!=='key')target.searchParams.set(k,v);
   }
   target.searchParams.set('key',key);target.searchParams.set('jscode',secret);
   try {
     const upstream=await fetch(target,{signal:AbortSignal.timeout(12000),redirect:'error'});
     if(isStatic){
       // Images must be relayed as bytes; text() would corrupt the PNG.
       const type=upstream.headers.get('content-type')||'';
       const buf=Buffer.from(await upstream.arrayBuffer());
       if(buf.length>STATIC_MAX_BYTES)throw new Error('UPSTREAM_SIZE');
       res.set('X-Content-Type-Options','nosniff');
       // AMap answers errors as JSON with HTTP 200; never cache or serve those as an image.
       if(!upstream.ok||!type.startsWith('image/')){res.set('Cache-Control','no-store');return res.status(502).json({error:{code:'MAP_UPSTREAM',message:'地图图片暂时无法载入'}});}
       res.set('Cache-Control','private, max-age=604800');
       return res.type(type).status(200).send(buf);
     }
     const result=await upstream.text();
     if(result.length>3_000_000)throw new Error('UPSTREAM_SIZE');
     res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
     res.type(req.query.callback?'application/javascript':'application/json');res.status(upstream.status).send(result);
   }catch{return res.status(502).json({error:{code:'MAP_UPSTREAM',message:'地图查询未完成，请重试'}});}
 });
 return router;
}
