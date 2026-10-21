import { describe, it, expect } from 'vitest';
import { Machine, ROOT_USER } from '@sigkill/machine';
import { Questbook, withCompanion, type Objective } from '../src/index.js';

const objective:Objective={id:'fix',title:'Fix it',teaches:['cat'],done:()=>false,
  routes:[1,2,3].map(n=>({name:String(n),commands:['true']})),
  nearMisses:[1,2].map(n=>({name:`miss${n}`,commands:['false'],because:'not fixed'})),
  steps:[
    {id:'first',label:'inspect the file',pending:w=>!w.vfs.exists('/tmp/first'),rungs:[{tier:'command',lines:['inspect'],command:'true'}]},
    {id:'second',label:'repair the file',pending:()=>true,rungs:[{tier:'command',lines:['repair'],command:'true'}]},
  ],
};
const options={speaker:'LUNA',topics:{joke:['A test walks into a bar.']},asides:{fix:'That changed something.'}};
function fresh(){const machine=new Machine();machine.vfs.mkdirp('/tmp',ROOT_USER);return {machine,questbook:new Questbook([objective])};}
describe('companion',()=>{
  it('answers optional questions without taking hints or spoiling a later step',async()=>{
    const s=withCompanion(fresh(),options);
    expect((await s.machine.exec('talk work')).stdout).toContain('inspect the file');
    expect((await s.machine.exec('luna joke')).stdout).toContain('walks into a bar');
    expect(s.questbook.hintsTaken).toBe(0);
    expect((await s.machine.exec('talk constructor')).stdout).toContain('Try talk');
    expect(s.afterCommand?.()).toEqual([]);
  });
  /** A save as the host writes it: both halves through JSON, nothing shared. */
  function reload(s:{machine:Machine;questbook:Questbook}){
    const machine=Machine.restore(JSON.parse(JSON.stringify(s.machine.snapshot())));
    const questbook=new Questbook([objective]);
    questbook.restore(JSON.parse(JSON.stringify(s.questbook.snapshot())));
    return {machine,questbook};
  }
  function speakUp(s:ReturnType<typeof withCompanion>){
    s.afterCommand?.();s.afterCommand?.();
    s.machine.vfs.writeText('/tmp/first','seen',ROOT_USER);
    return s.afterCommand?.();
  }
  it('reacts to a state change once and remembers across reload',()=>{
    const s=withCompanion(fresh(),options);
    expect(speakUp(s)).toEqual(['LUNA: That changed something.']);
    expect(s.afterCommand?.()).toEqual([]);
    const back=withCompanion(reload(s),options);
    back.machine.vfs.unlink('/tmp/first',ROOT_USER);
    back.afterCommand?.();
    expect(speakUp(back)).toEqual([]);
  });
  it('keeps its memory in the save, not in the player\'s filesystem',()=>{
    const s=withCompanion(fresh(),options);
    speakUp(s);
    expect(s.machine.vfs.exists('/var/lib/sigkill',ROOT_USER)).toBe(false);
    expect(s.questbook.snapshot().remembered).toEqual(['aside:fix']);
  });
  it('carries a memory file from an older save over, then removes it',()=>{
    const raw=fresh();
    raw.machine.vfs.mkdirp('/var/lib/sigkill',ROOT_USER);
    raw.machine.vfs.writeText('/var/lib/sigkill/companion.json','["fix"]',ROOT_USER);
    const s=withCompanion(raw,options);
    expect(s.machine.vfs.exists('/var/lib/sigkill',ROOT_USER)).toBe(false);
    expect(speakUp(s)).toEqual([]);
  });
  it('still speaks when an old save never remembered anything',()=>{
    const raw=fresh();
    raw.questbook.restore({version:1,revealed:{},asked:0});
    expect(speakUp(withCompanion(raw,options))).toEqual(['LUNA: That changed something.']);
  });
});
