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
    expect(s.afterCommand?.()).toEqual([]);
  });
  it('reacts to a state change once and remembers across reload',()=>{
    const raw=fresh();const s=withCompanion(raw,options);
    s.afterCommand?.();s.afterCommand?.();
    s.machine.vfs.writeText('/tmp/first','seen',ROOT_USER);
    expect(s.afterCommand?.()).toEqual(['LUNA: That changed something.']);
    expect(s.afterCommand?.()).toEqual([]);
    const machine=Machine.restore(s.machine.snapshot());
    machine.vfs.unlink('/tmp/first',ROOT_USER);
    const back=withCompanion({machine,questbook:raw.questbook},options);
    back.afterCommand?.();back.afterCommand?.();
    machine.vfs.writeText('/tmp/first','seen',ROOT_USER);
    expect(back.afterCommand?.()).toEqual([]);
  });
});
