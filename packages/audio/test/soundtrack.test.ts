import { afterEach, describe, expect, it, vi } from 'vitest';
import { Soundtrack, mixFor } from '../src/index.js';

class Param {
  value=0;
  setTargetAtTime=vi.fn((value:number)=>{this.value=value;});
  setValueAtTime(value:number) {this.value=value;}
  linearRampToValueAtTime(value:number) {this.value=value;}
  exponentialRampToValueAtTime(value:number) {this.value=value;}
}
class Node {
  gain=new Param();frequency=new Param();Q=new Param();
  connect(other:unknown){return other as Node;}
  start(){} stop(){}
}
class Context {
  state='running';currentTime=0;sampleRate=100;destination=new Node();
  oscillators:Node[]=[];
  createGain(){return new Node();}
  createOscillator(){const n=new Node();this.oscillators.push(n);return n;}
  createBiquadFilter(){return new Node();}
  createBufferSource(){return new Node();}
  createBuffer(){return {getChannelData:()=>new Float32Array(100)};}
  async resume(){this.state='running';}
  async suspend(){this.state='suspended';}
  async close(){this.state='closed';}
}
let sound:Soundtrack|undefined;
afterEach(()=>{sound?.close();vi.unstubAllGlobals();vi.useRealTimers();});
describe('audible state transitions',()=>{
  it('retunes the existing reactor as strain falls',async()=>{
    let context:Context;
    vi.stubGlobal('AudioContext',class extends Context {constructor(){super();context=this;}});
    vi.useFakeTimers();
    sound=new Soundtrack();
    sound.setState({scrubber:false,monitor:false,breached:false,reserve:0});
    await sound.resume();
    const oscillator=context!.oscillators[0]!;
    expect(oscillator.frequency.value).toBe(62);
    sound.setState({scrubber:false,monitor:false,breached:false,reserve:1});
    expect(oscillator.frequency.value).toBe(54);
    expect(context!.oscillators).toHaveLength(2);
  });
  it('really silences the fallback and separates settings',()=>{
    expect(Object.values(mixFor({scene:'silent',scrubber:false,monitor:false,breached:false,reserve:1})).every(x=>x.gain===0)).toBe(true);
    sound=new Soundtrack();sound.setChannel('effects',0);sound.setChannel('ambience',0.4);
    expect(sound.channelVolume('effects')).toBe(0);
    expect(sound.channelVolume('ambience')).toBe(0.4);
  });
});
