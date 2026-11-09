-- Isolated local PostgreSQL only. Load the main/admin baseline, local bootstrap
-- helpers and every migration first (see docs/database-week9.md). Never run
-- local_bootstrap*.sql or this file against Supabase production. Rolls back.
begin;
insert into auth.users(id,email) values
 ('b9000000-0000-4000-8000-000000000001','admin-nine@example.invalid'),
 ('b9000000-0000-4000-8000-000000000002','member-nine@example.invalid'),
 ('b9000000-0000-4000-8000-000000000003','password-nine@example.invalid');
insert into public.profiles(id,first_name,is_superadmin) values
 ('b9000000-0000-4000-8000-000000000001','Admin',true),
 ('b9000000-0000-4000-8000-000000000002','Member',false),
 ('b9000000-0000-4000-8000-000000000003','Password',true);

-- Anonymous visitors cannot reach any Week 9 entry point.
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"anon"}',true);
do $$begin
 begin perform public.prompt_chain_tool_state_v9();raise exception 'FAIL anon state';exception when insufficient_privilege then null;end;
 begin perform public.prompt_chain_save_v9(null,'{"name":"x"}');raise exception 'FAIL anon create';exception when insufficient_privilege then null;end;
 begin perform public.prompt_chain_media_v9('83000000-0000-4000-8000-000000000001');raise exception 'FAIL anon media';exception when insufficient_privilege then null;end;
 begin perform public.resolve_chain_runtime_v9('83000000-0000-4000-8000-000000000001','dry');raise exception 'FAIL anon runtime';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Ordinary Google member and a flagged password account are both denied.
set local role authenticated;
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"role":"authenticated","app_metadata":{"provider":"google"},"amr":[{"method":"oauth"}]}',true);
do $$begin
 begin perform public.prompt_chain_tool_state_v9();raise exception 'FAIL member state';exception when insufficient_privilege then null;end;
 begin perform public.prompt_chain_detail_v9('83000000-0000-4000-8000-000000000001');raise exception 'FAIL member detail';exception when insufficient_privilege then null;end;
 begin perform public.prompt_chain_save_v9('83000000-0000-4000-8000-000000000001','{"weight":0}');raise exception 'FAIL member chain edit';exception when insufficient_privilege then null;end;
 begin perform public.prompt_chain_delete_v9('83000000-0000-4000-8000-000000000001');raise exception 'FAIL member delete';exception when insufficient_privilege then null;end;
 begin perform public.prompt_chain_step_save_v9('83000000-0000-4000-8000-000000000001',null,'{"name":"x","system_prompt":"x","model_id":"82000000-0000-4000-8000-000000000001"}');raise exception 'FAIL member step create';exception when insufficient_privilege then null;end;
 begin perform public.prompt_chain_step_delete_v9('84000000-0000-4000-8000-000000000001');raise exception 'FAIL member step delete';exception when insufficient_privilege then null;end;
 begin perform public.prompt_chain_step_reorder_v9('83000000-0000-4000-8000-000000000001',array['84000000-0000-4000-8000-000000000001']::uuid[]);raise exception 'FAIL member reorder';exception when insufficient_privilege then null;end;
 begin perform public.resolve_chain_runtime_v9('83000000-0000-4000-8000-000000000001','dry');raise exception 'FAIL member chain runtime';exception when insufficient_privilege then null;end;
 begin perform public.prompt_chain_media_v9('83000000-0000-4000-8000-000000000001');raise exception 'FAIL member media';exception when insufficient_privilege then null;end;
 begin perform punchline_private.prompt_chain_row_v9('83000000-0000-4000-8000-000000000001');raise exception 'FAIL private helper';exception when insufficient_privilege then null;end;
 begin update public.prompt_chain_steps set position=2;raise exception 'FAIL raw step write';exception when insufficient_privilege then null;end;
 -- The ordinary random runtime still works for members.
 if public.resolve_caption_runtime_v7('dry')#>>'{chain,id}' not in ('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002') then raise exception 'FAIL member runtime';end if;
end $$;
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000003',true),set_config('request.jwt.claims','{"role":"authenticated","app_metadata":{"provider":"email"},"amr":[{"method":"password"}],"user_metadata":{"provider":"google"}}',true);
do $$begin begin perform public.prompt_chain_tool_state_v9();raise exception 'FAIL password admin';exception when insufficient_privilege then null;end;end $$;

-- Approved Google administrator.
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"role":"authenticated","app_metadata":{"provider":"google"},"amr":[{"method":"oauth"}]}',true);
do $$
declare state jsonb; chain jsonb; chain_id uuid; step jsonb; ids uuid[]:='{}'; detail jsonb; i integer; model uuid:='82000000-0000-4000-8000-000000000001'; runtime jsonb; positions int[];
begin
 state:=public.prompt_chain_tool_state_v9();
 if (state->>'mix_size')::int<>2 or jsonb_array_length(state->'models')<1 or jsonb_array_length(state->'chains')<2 then raise exception 'FAIL initial state %',state;end if;
 -- Validation
 begin perform public.prompt_chain_save_v9(null,'{}');raise exception 'FAIL empty payload';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_save_v9(null,'{"name":"  "}');raise exception 'FAIL blank name';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_save_v9(null,'{"name":"x","weight":101}');raise exception 'FAIL weight bound';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_save_v9(null,'{"name":"x","weight":1.5}');raise exception 'FAIL fractional weight';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_save_v9(null,'{"name":"x","api_key":"SECRET"}');raise exception 'FAIL unknown field';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_save_v9(null,'{"name":null}');raise exception 'FAIL null field';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_save_v9(null,'{"name":"Short observations"}');raise exception 'FAIL duplicate name';exception when unique_violation then null;end;
 -- Create chain: weight 0 by default, not runnable by the public app.
 chain:=public.prompt_chain_save_v9(null,'{"name":"Week 9 describe-then-joke","description":"Image to description to joke to captions."}');
 chain_id:=(chain->>'id')::uuid;
 if (chain->>'weight')::int<>0 or (chain->>'public_eligible')::boolean or (chain->>'step_count')::int<>0 then raise exception 'FAIL new chain defaults %',chain;end if;
 begin perform public.resolve_chain_runtime_v9(chain_id,'dry');raise exception 'FAIL empty chain runnable';exception when raise_exception then null;end;
 -- Update chain
 chain:=public.prompt_chain_save_v9(chain_id,'{"description":"Updated description","is_active":true}');
 if chain->>'description'<>'Updated description' or chain->>'name'<>'Week 9 describe-then-joke' then raise exception 'FAIL chain update';end if;
 -- Steps: validation
 begin perform public.prompt_chain_step_save_v9(chain_id,null,'{"name":"x","system_prompt":"x"}');raise exception 'FAIL step missing model';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_step_save_v9(chain_id,null,jsonb_build_object('name','x','system_prompt','x','model_id',gen_random_uuid()));raise exception 'FAIL unknown model';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_step_save_v9(chain_id,null,jsonb_build_object('name','x','system_prompt','x','model_id',model,'temperature',3));raise exception 'FAIL temperature bound';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_step_save_v9(chain_id,null,jsonb_build_object('name','x','system_prompt',repeat('a',4001),'model_id',model));raise exception 'FAIL prompt length';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_step_save_v9(gen_random_uuid(),null,jsonb_build_object('name','x','system_prompt','x','model_id',model));raise exception 'FAIL missing chain';exception when no_data_found then null;end;
 -- Create eight steps, then the ninth is refused.
 for i in 1..8 loop
  step:=public.prompt_chain_step_save_v9(chain_id,null,jsonb_build_object('name','Step '||i,'system_prompt','Instruction '||i,'model_id',model,'temperature',0.5,'max_output_tokens',512));
  if (step->>'position')::int<>i then raise exception 'FAIL append position % %',i,step;end if;
  ids:=ids||(step->>'id')::uuid;
 end loop;
 begin perform public.prompt_chain_step_save_v9(chain_id,null,jsonb_build_object('name','Nine','system_prompt','x','model_id',model));raise exception 'FAIL step limit';exception when raise_exception then null;end;
 -- Update step
 step:=public.prompt_chain_step_save_v9(chain_id,ids[2],'{"system_prompt":"Updated instruction 2","temperature":1.1}');
 if step->>'system_prompt'<>'Updated instruction 2' or (step->>'temperature')::numeric<>1.1 or (step->>'position')::int<>2 then raise exception 'FAIL step update';end if;
 begin perform public.prompt_chain_step_save_v9('83000000-0000-4000-8000-000000000001',ids[2],'{"name":"cross-chain"}');raise exception 'FAIL cross-chain step edit';exception when no_data_found then null;end;
 -- Eight active steps: runnable by the tool, not eligible for the public app even with weight.
 chain:=public.prompt_chain_save_v9(chain_id,'{"weight":50}');
 if (chain->>'public_eligible')::boolean then raise exception 'FAIL 8-step chain public';end if;
 runtime:=public.resolve_chain_runtime_v9(chain_id,'dry');
 if jsonb_array_length(runtime->'steps')<>8 or runtime#>>'{chain,id}'<>chain_id::text or runtime->>'tool'<>'prompt-chain-tool-v9' then raise exception 'FAIL tool runtime';end if;
 for i in 1..40 loop
  if public.resolve_caption_runtime_v7('dry')#>>'{chain,id}'=chain_id::text then raise exception 'FAIL public runtime chose 8-step chain';end if;
 end loop;
 -- Reorder: move step 2 to the front.
 detail:=public.prompt_chain_step_reorder_v9(chain_id,array[ids[2],ids[1]]||ids[3:8]);
 if detail#>>'{steps,0,id}'<>ids[2]::text or detail#>>'{steps,1,id}'<>ids[1]::text or (detail#>>'{steps,0,position}')::int<>1 then raise exception 'FAIL reorder %',detail;end if;
 begin perform public.prompt_chain_step_reorder_v9(chain_id,ids[1:7]);raise exception 'FAIL stale subset';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_step_reorder_v9(chain_id,array[ids[1],ids[1]]||ids[3:8]);raise exception 'FAIL duplicate order';exception when invalid_parameter_value then null;end;
 begin perform public.prompt_chain_step_reorder_v9(chain_id,ids[1:7]||'84000000-0000-4000-8000-000000000001'::uuid);raise exception 'FAIL foreign step';exception when invalid_parameter_value then null;end;
 -- Delete: remove five steps; positions stay contiguous.
 for i in 4..8 loop detail:=public.prompt_chain_step_delete_v9(ids[i]); end loop;
 select array_agg((x->>'position')::int order by (x->>'position')::int) into positions from jsonb_array_elements(detail->'steps') x;
 if positions<>array[1,2,3] or detail#>>'{steps,0,id}'<>ids[2]::text then raise exception 'FAIL compact %',detail;end if;
 if not (detail#>>'{chain,public_eligible}')::boolean then raise exception 'FAIL 3-step chain eligible';end if;
 perform set_config('week9.chain_id',chain_id::text,true);
 perform set_config('week9.step_ids',array_to_string(array[ids[2],ids[1],ids[3]],','),true);
end $$;

-- Mix guard: the public app is never left with zero runnable chains.
do $$declare tool_chain uuid:=current_setting('week9.chain_id')::uuid;
begin
 perform public.prompt_chain_save_v9(tool_chain,'{"weight":0}');
 perform public.prompt_chain_save_v9('83000000-0000-4000-8000-000000000002','{"weight":0}');
 begin perform public.prompt_chain_save_v9('83000000-0000-4000-8000-000000000001','{"weight":0}');raise exception 'FAIL zero mix weight';exception when raise_exception then if sqlerrm<>'PROMPT_CHAIN_MIX_EMPTY' then raise; end if;end;
 begin perform public.prompt_chain_save_v9('83000000-0000-4000-8000-000000000001','{"is_active":false}');raise exception 'FAIL disable last';exception when raise_exception then if sqlerrm<>'PROMPT_CHAIN_MIX_EMPTY' then raise; end if;end;
 begin perform public.prompt_chain_step_delete_v9('84000000-0000-4000-8000-000000000001');raise exception 'FAIL delete last step';exception when raise_exception then if sqlerrm<>'PROMPT_CHAIN_MIX_EMPTY' then raise; end if;end;
 begin perform public.prompt_chain_delete_v9('83000000-0000-4000-8000-000000000001');raise exception 'FAIL delete last chain';exception when raise_exception then if sqlerrm<>'PROMPT_CHAIN_MIX_EMPTY' then raise; end if;end;
 begin perform public.prompt_chain_step_save_v9('83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','{"is_active":false}');raise exception 'FAIL deactivate last step';exception when raise_exception then if sqlerrm<>'PROMPT_CHAIN_MIX_EMPTY' then raise; end if;end;
 perform public.prompt_chain_save_v9('83000000-0000-4000-8000-000000000002','{"weight":30}');
end $$;

-- Real generation path through a chosen chain, recorded with per-step output.
do $$
declare chain_id uuid:=current_setting('week9.chain_id')::uuid; steps uuid[]:=string_to_array(current_setting('week9.step_ids'),',')::uuid[];
 runtime jsonb; reservation record; request_id uuid; response uuid; media jsonb; i integer;
begin
 runtime:=public.resolve_chain_runtime_v9(chain_id,'dry');
 select * into reservation from public.reserve_caption_generation_v5(gen_random_uuid(),'photo-coffee','Describe, then joke.','dry',runtime#>>'{steps,2,system_prompt}','deepseek-flash','other','observer');
 request_id:=public.attach_caption_runtime_v7(reservation.id,(runtime->>'config_token')::uuid);
 for i in 1..2 loop
  response:=public.begin_llm_response_v7(request_id,steps[i],'system '||i,'user '||i,'chain_step');
  perform public.finish_llm_response_v7(response,'succeeded','{"output":"step '||i||' output"}',null,1200,'deepseek-flash',100,40);
 end loop;
 begin perform public.begin_llm_response_v7(request_id,'84000000-0000-4000-8000-000000000001','x','y','chain_step');raise exception 'FAIL foreign step telemetry';exception when invalid_parameter_value then null;end;
 response:=public.begin_llm_response_v7(request_id,steps[3],'system 3','user 3','captions');
 perform public.finish_llm_response_v7(response,'succeeded','{"captions":["a","b","c"]}',null,1500,'deepseek-flash',120,30);
 perform public.complete_caption_generation_v6(reservation.id,array['My coffee has a longer reading list','The laptop is pretending to be busy','This saucer has seen my deadlines']);
 media:=public.prompt_chain_media_v9(chain_id);
 if (media->>'total')::int<>1 or jsonb_array_length(media#>'{rows,0,captions}')<>3 or jsonb_array_length(media#>'{rows,0,steps}')<>3
   or not (media#>>'{rows,0,via_tool}')::boolean or media#>>'{rows,0,status}'<>'succeeded' or media#>>'{rows,0,image,id}'<>'photo-coffee'
   or media#>>'{rows,0,steps,0,output}'<>'{"output":"step 1 output"}' then raise exception 'FAIL chain media %',media;end if;
 if (public.prompt_chain_media_v9('83000000-0000-4000-8000-000000000001')->>'total')::int<>0 then raise exception 'FAIL media leak across chains';end if;
 if (public.prompt_chain_detail_v9(chain_id)#>>'{chain,media_count}')::int<>3 then raise exception 'FAIL media count';end if;
 perform set_config('week9.generation_id',reservation.id::text,true);
end $$;

-- Deleting a chain with history keeps the captions, prompts and telemetry names.
do $$declare chain_id uuid:=current_setting('week9.chain_id')::uuid; generation uuid:=current_setting('week9.generation_id')::uuid;
begin
 perform public.prompt_chain_delete_v9(chain_id);
 begin perform public.prompt_chain_detail_v9(chain_id);raise exception 'FAIL deleted chain readable';exception when no_data_found then null;end;
end $$;
reset role;
do $$declare generation uuid:=current_setting('week9.generation_id')::uuid;
begin
 if exists(select 1 from public.prompt_chain_steps where chain_id=current_setting('week9.chain_id')::uuid) then raise exception 'FAIL orphan steps';end if;
 if (select count(*) from public.captions where generation_id=generation)<>3 then raise exception 'FAIL captions removed';end if;
 if not exists(select 1 from public.generation_requests where generation_id=generation and prompt_chain_id is null and chain_name='Week 9 describe-then-joke') then raise exception 'FAIL request history';end if;
 if (select count(*) from public.llm_responses l join public.generation_requests r on r.id=l.generation_request_id where r.generation_id=generation and l.step_id is null and l.step_name like 'Step %' and l.output is not null)<>3 then raise exception 'FAIL telemetry history';end if;
 if (select count(*) from public.admin_record_audit where resource in ('prompt_chains','prompt_chain_steps') and action in ('create','update','delete','reorder'))<16 then raise exception 'FAIL audit trail';end if;
 if not exists(select 1 from public.admin_record_audit where action='reorder') or not exists(select 1 from public.admin_record_audit where action='delete' and resource='prompt_chains') then raise exception 'FAIL audit actions';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%\_v9' and p.prosecdef) then raise exception 'FAIL public definer wrapper';end if;
 if has_function_privilege('anon','public.prompt_chain_save_v9(uuid,jsonb)','execute') or has_function_privilege('authenticated','punchline_private.prompt_chain_row_v9(uuid)','execute') then raise exception 'FAIL grants';end if;
 raise notice 'PASS: Week 9 admin gates, chain/step CRUD, reorder, 8-step limit, public-mix guard, chain-specific runtime, per-chain media and history-preserving delete.';
end $$;
rollback;
