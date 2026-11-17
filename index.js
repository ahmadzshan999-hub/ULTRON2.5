import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const required = ['SUPABASE_URL','SUPABASE_ANON_KEY','OPENAI_API_KEY'];
for (const key of required) if (!process.env[key]) console.warn(`Missing environment variable: ${key}`);

const openai = process.env.OPENAI_API_KEY ? new OpenAI({apiKey:process.env.OPENAI_API_KEY}) : null;
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  : null;

app.use(cors({origin:process.env.NODE_ENV==='production'?false:true}));
app.use(express.json({limit:'1mb'}));
app.use('/api/',rateLimit({windowMs:60_000,limit:30,standardHeaders:true,legacyHeaders:false}));

const upload = multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:8*1024*1024,files:1},
  fileFilter:(_req,file,cb)=>{
    const allowed=['text/plain','text/markdown','text/csv','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const ext=path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ['.txt','.md','.csv','.pdf','.docx'].includes(ext)) cb(null,true);
    else cb(new Error('Unsupported file type. Upload TXT, MD, CSV, PDF or DOCX.'));
  }
});

async function requireUser(req,res,next) {
  try {
    if (!supabase) return res.status(503).json({error:'Supabase is not configured on the server.'});
    const header=req.headers.authorization||'';
    const token=header.startsWith('Bearer ')?header.slice(7):'';
    if (!token) return res.status(401).json({error:'Sign in to continue.'});
    const {data,error}=await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({error:'Your session is invalid. Please sign in again.'});
    req.user=data.user; req.accessToken=token; next();
  } catch { res.status(401).json({error:'Could not verify your session.'}); }
}

async function extractFile(file) {
  if (!file) return '';
  const ext=path.extname(file.originalname).toLowerCase();
  if (ext==='.pdf' || file.mimetype==='application/pdf') {
    const parsed=await pdf(file.buffer);
    return parsed.text.slice(0,30000);
  }
  if (ext==='.docx' || file.mimetype.includes('wordprocessingml')) {
    const parsed=await mammoth.extractRawText({buffer:file.buffer});
    return parsed.value.slice(0,30000);
  }
  return file.buffer.toString('utf8').slice(0,30000);
}

app.post('/api/chat',requireUser,upload.single('file'),async(req,res)=>{
  if (!openai) return res.status(503).json({error:'OpenAI is not configured. Add OPENAI_API_KEY to the server .env file.'});
  const message=String(req.body.message||'').trim();
  if (!message && !req.file) return res.status(400).json({error:'Write a message or attach a file.'});
  let history=[];
  try { history=JSON.parse(req.body.history||'[]'); } catch {}
  if (!Array.isArray(history)) history=[];
  history=history.filter(m=>['user','assistant'].includes(m?.role)&&typeof m?.content==='string').slice(-16);
  try {
    const fileText=await extractFile(req.file);
    const userText=[message||'Please analyze the attached file.',fileText?`\n\nAttached file: ${req.file.originalname}\n\nFile contents:\n${fileText}`:''].join('');
    const input=[
      ...history.map(m=>({role:m.role,content:m.content.slice(0,12000)})),
      {role:'user',content:userText}
    ];
    res.setHeader('Content-Type','text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control','no-cache, no-transform');
    res.setHeader('Connection','keep-alive');
    res.flushHeaders?.();
    const stream=await openai.responses.create({
      model:process.env.OPENAI_MODEL||'gpt-5.5',
      instructions:'You are ULTRON, a helpful, accurate, friendly AI assistant. Be clear and useful. If you are unsure, say so.',
      input,
      stream:true
    });
    for await (const event of stream) {
      if (req.aborted) break;
      if (event.type==='response.output_text.delta') res.write(`data: ${JSON.stringify({delta:event.delta})}\n\n`);
      if (event.type==='response.failed') res.write(`data: ${JSON.stringify({error:event.response?.error?.message||'The AI response failed.'})}\n\n`);
    }
    res.write('data: {"done":true}\n\n');
    res.end();
  } catch(err) {
    console.error('Chat error:',err);
    if (!res.headersSent) return res.status(500).json({error:err.message||'AI request failed.'});
    res.write(`data: ${JSON.stringify({error:err.message||'AI request failed.'})}\n\n`);
    res.end();
  }
});

app.get('/api/health',(_req,res)=>res.json({ok:true,service:'ULTRON API'}));

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const dist=path.resolve(__dirname,'../client/dist');
if (process.env.NODE_ENV==='production') {
  app.use(express.static(dist));
  app.get('*',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
}

app.use((err,_req,res,_next)=>{
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({error:err.message});
  res.status(400).json({error:err.message||'Request failed.'});
});

app.listen(PORT,()=>console.log(`ULTRON server listening on http://localhost:${PORT}`));
