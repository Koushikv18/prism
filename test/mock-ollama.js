// Scripted fake Ollama used by the e2e tests (streaming NDJSON, tool calls, FIM completion, embeddings).
const http=require('http');
const send=(res,objs)=>{res.setHeader('content-type','application/x-ndjson');for(const o of objs)res.write(JSON.stringify(o)+'\n');res.end();};
http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{
 if(req.url==='/api/tags'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({models:[{name:'qwen2.5-coder:7b'}]}));}
 const body=b?JSON.parse(b):{};
 if(req.url==='/api/generate'){console.log('GEN suffix=',JSON.stringify(body.suffix).slice(0,30),'ctx',body.options.num_ctx);return send(res,[{response:'completed_by_ai()',done:true}]);}
 if(req.url==='/api/chat'){if(body.model==='missing-model'){res.statusCode=404;res.setHeader('content-type','application/json');return res.end(JSON.stringify({error:"model 'missing-model' not found"}));}
  const ms=body.messages,sys=ms[0].content,last=ms[ms.length-1];
  console.log('CHAT stream=',body.stream,'num_ctx=',body.options&&body.options.num_ctx,'last=',last.role,JSON.stringify(last.content).slice(0,60));
  if(/precise code editor/.test(sys))return send(res,[{message:{role:'assistant',content:'```js\nconst total = items.reduce((a, b) => a + b, 0);\n```'},done:true}]);
  const user=[...ms].reverse().find(m=>m.role==='user'&&!/^You have not used/.test(m.content)).content;
  const nudged=ms.some(m=>m.role==='user'&&/^You have not used/.test(m.content));
  if(last.role==='tool')return send(res,[{message:{role:'assistant',content:'Done. '}},{message:{role:'assistant',content:'All set.'},done:true}]);
  if(/nudge/.test(user)&&!nudged)return send(res,[{message:{role:'assistant',content:'You could create a file called '}},{message:{role:'assistant',content:'a.txt with some text.'},done:true}]);
  if(/alias/.test(user))return send(res,[{message:{role:'assistant',content:'',tool_calls:[{function:{name:'create_file',arguments:{file_path:'alias.txt',contents:'alias ok'}}}]},done:true}]);
  const path=/nudge/.test(user)?'a.txt':'hello.txt';
  return send(res,[{message:{role:'assistant',content:'Creating '}},{message:{role:'assistant',content:'the file.',tool_calls:[{function:{name:'write_file',arguments:{path,content:'hi from agent v2'}}}]},done:true}]);}
 res.statusCode=404;res.end('{}');});}).listen(process.env.MOCK_PORT||11999,'127.0.0.1');
