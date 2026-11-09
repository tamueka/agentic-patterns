import './helpers/string-colors.js';
import { orchestratorWorkersMain } from './patterns/09-orchestrator/orchestrator.js';
// import { routingMain } from './patterns/08-routing/multi-routing.js';
// import { codeActMain } from './patterns/07-codeAct/codeAct.js';
// import { planAndExecuteMain } from './patterns/06-plan-and-execute/plan-and-execute.js';
// import { promptChainingMain } from './patterns/05-promp-chaining/promp-chaining.js';
// import { reActWeatherMain } from './patterns/04-reAct/reAct-tarea.js';
// import { reActSimpleMain } from './patterns/04-reAct/reAct-loop.js';
// import { reflectionMain } from './patterns/03-reflection/reflection.js';
// import { toolUseMain } from './patterns/01-tool-use/tool-use.js';
// import { planningMain, withoutPlanning } from './patterns/02-planning/planning.js';
// import { getMessageFromModel } from './actions/get-message-model.js';

console.clear();

// await getMessageFromModel();
// await toolUseMain();
// await planningMain();
// await reflectionMain();
// await reActSimpleMain();
// await reActWeatherMain();
// await promptChainingMain();
// await planAndExecuteMain();
// await codeActMain();
// await routingMain();
await orchestratorWorkersMain();
