import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createChatSound } from '../src/chat-sound';
let contexts:any[],sources:any[];
beforeEach(()=>{
 contexts=[];sources=[];vi.stubGlobal('Audio',vi.fn());
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)})));
 vi.stubGlobal('AudioContext',class{
  state='running';destination={};decodeAudioData=vi.fn(async()=>({}));close=vi.fn(async()=>{});resume=vi.fn(async()=>{this.state='running';});
  constructor(){contexts.push(this);}
  createBufferSource(){const source={buffer:null,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null};sources.push(source);return source;}
 });
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('reuses decoded audio, never creates another music Audio element, and prevents overlapping effects',async()=>{
 const sound=createChatSound('/sound.wav');await sound.play(()=>true);await sound.play(()=>true);
 expect(contexts).toHaveLength(1);expect(fetch).toHaveBeenCalledOnce();expect(sources[0].stop).toHaveBeenCalledOnce();expect(sources[1].start).toHaveBeenCalledOnce();expect(Audio).not.toHaveBeenCalled();sound.dispose();
});
it('does not play audio from a room left while decoding was pending',async()=>{
 let resolve!:(r:any)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>resolve=r)));let current=true;
 const sound=createChatSound('/sound.wav'),pending=sound.play(()=>current);current=false;sound.stop();resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});await pending;expect(sources).toHaveLength(0);sound.dispose();
});
it('fails a blocked autoplay attempt rather than queuing an unexpected sound indefinitely',async()=>{
 vi.useFakeTimers();const sound=createChatSound('/sound.wav');sound.unlock();await Promise.resolve();contexts[0].state='suspended';contexts[0].resume.mockImplementation(()=>new Promise(()=>{}));
 const result=expect(sound.play(()=>true)).rejects.toThrow('SOUND_TIMEOUT');await vi.advanceTimersByTimeAsync(5000);await result;sound.dispose();
});
it('packages a nonempty stereo PCM WAV derived from the specified notification clip',()=>{
 const bytes=readFileSync(new URL('../src/assets/chat-notification.wav',import.meta.url));expect(bytes.toString('ascii',0,4)).toBe('RIFF');expect(bytes.toString('ascii',8,12)).toBe('WAVE');expect(bytes.readUInt16LE(20)).toBe(1);expect(bytes.readUInt16LE(22)).toBe(2);expect(bytes.readUInt32LE(24)).toBe(48000);expect(bytes.length).toBe(958696);
});
