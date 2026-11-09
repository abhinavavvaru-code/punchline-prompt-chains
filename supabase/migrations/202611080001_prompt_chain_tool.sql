-- Week 9: prompt chain tool. Apply after the administrator repository's
-- 202610260002_week7_operations.sql. Additive and transactional: it keeps every
-- existing chain, step, generation, caption, vote, prompt and telemetry row.
-- Every new client entry point repeats the Google + profiles.is_superadmin gate.
begin;

-- Chains may now have up to eight ordered steps. Uniqueness is checked at the
-- end of each statement so one UPDATE can reorder a whole chain atomically.
alter table public.prompt_chain_steps drop constraint prompt_chain_steps_position_check;
alter table public.prompt_chain_steps add constraint prompt_chain_steps_position_check check(position between 1 and 8);
alter table public.prompt_chain_steps drop constraint prompt_chain_steps_chain_id_position_key;
alter table public.prompt_chain_steps add constraint prompt_chain_steps_chain_id_position_key unique(chain_id,position) deferrable initially immediate;

-- Deleting a chain or step keeps the historical generation and LLM rows. Those
-- rows already store chain_name/step_name and the frozen config snapshot, so
-- only the live link is cleared; no telemetry text is rewritten or invented.
alter table public.llm_responses drop constraint llm_responses_step_id_fkey;
alter table public.llm_responses add constraint llm_responses_step_id_fkey foreign key(step_id) references public.prompt_chain_steps(id) on delete set null;
alter table public.generation_requests drop constraint generation_requests_prompt_chain_id_fkey;
alter table public.generation_requests add constraint generation_requests_prompt_chain_id_fkey foreign key(prompt_chain_id) references public.prompt_chains(id) on delete set null;
alter table public.admin_record_audit drop constraint admin_record_audit_action_check;
alter table public.admin_record_audit add constraint admin_record_audit_action_check check(action in ('create','update','archive','restore','delete','reorder'));

-- A chain the public caption app can run: active, unarchived, one to three
-- active steps (the deployed main app's limit), and only enabled DeepSeek
-- models whose keys the server integrations allowlist.
create function punchline_private.prompt_chain_public_eligible_v9(p_chain_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.prompt_chains c where c.id=p_chain_id and c.is_active and c.archived_at is null)
  and (select count(*) from public.prompt_chain_steps s where s.chain_id=p_chain_id and s.is_active) between 1 and 3
  and not exists(select 1 from public.prompt_chain_steps s join public.llm_models m on m.id=s.model_id join public.llm_providers p on p.id=m.provider_id
    where s.chain_id=p_chain_id and s.is_active and (not m.is_active or m.archived_at is not null or not p.is_active or p.archived_at is not null
      or p.slug<>'deepseek' or m.model_key not in ('deepseek-flash','deepseek-v4-pro')));
$$;

create function punchline_private.prompt_chain_mix_size_v9()
returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.prompt_chains c where c.weight>0 and punchline_private.prompt_chain_public_eligible_v9(c.id);
$$;

-- Same selection as Week 7, but a chain is only eligible when the public app can
-- actually execute it. New tool chains default to weight 0, so they stay out of
-- the public mix until an administrator deliberately gives them weight.
create or replace function punchline_private.resolve_caption_runtime_v7(p_style text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); selected_chain public.prompt_chains%rowtype; configuration jsonb; token uuid;
begin
 if auth.role() is distinct from 'authenticated' or caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
 if p_style is null or p_style not in ('dry','chaotic','wholesome','wordplay','roast') then raise exception using errcode='22023',message='INVALID_GENERATION_STYLE'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('runtime-selection:'||caller::text,0));
 if (select count(*) from punchline_private.runtime_selections_v7 s where s.user_id=caller and s.created_at>=now()-interval '1 day')>=50 then
  raise exception using errcode='P0001',message='RUNTIME_SELECTION_LIMIT_REACHED'; end if;
 select c.* into selected_chain from public.prompt_chains c
 where c.weight>0 and punchline_private.prompt_chain_public_eligible_v9(c.id)
 order by -ln(greatest(random(),0.000000001))/c.weight limit 1;
 if not found then raise exception using errcode='P0001',message='NO_ACTIVE_PROMPT_CHAIN'; end if;
 select jsonb_build_object('chain',jsonb_build_object('id',selected_chain.id,'name',selected_chain.name),
  'steps',(select jsonb_agg(jsonb_build_object('id',s.id,'position',s.position,'name',s.name,'system_prompt',s.system_prompt,
    'provider_slug',p.slug,'model_id',m.id,'model_key',m.model_key,'supports_vision',m.supports_vision,'temperature',s.temperature,
    'max_output_tokens',least(s.max_output_tokens,m.max_output_tokens)) order by s.position)
    from public.prompt_chain_steps s join public.llm_models m on m.id=s.model_id join public.llm_providers p on p.id=m.provider_id where s.chain_id=selected_chain.id and s.is_active),
  'terms',coalesce((select jsonb_agg(to_jsonb(t)) from(select term,definition,example from public.humor_terms where is_active and archived_at is null order by term limit 20)t),'[]'::jsonb),
  'examples',coalesce((select jsonb_agg(to_jsonb(e)) from(select image_description,caption,explanation,style from public.ai_generation_examples
    where is_active and archived_at is null and style in ('any',p_style) order by created_at desc,id limit 10)e),'[]'::jsonb)) into configuration;
 insert into punchline_private.runtime_selections_v7(user_id,style,snapshot) values(caller,p_style,configuration) returning id into token;
 return configuration||jsonb_build_object('config_token',token);
end $$;

create function punchline_private.prompt_chain_row_v9(p_chain_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object(
  'step_count',(select count(*) from public.prompt_chain_steps s where s.chain_id=c.id),
  'active_step_count',(select count(*) from public.prompt_chain_steps s where s.chain_id=c.id and s.is_active),
  'media_count',(select count(*) from public.generation_requests r join public.captions k on k.generation_id=r.generation_id where r.prompt_chain_id=c.id),
  'run_count',(select count(*) from public.generation_requests r where r.prompt_chain_id=c.id),
  'public_eligible',punchline_private.prompt_chain_public_eligible_v9(c.id))
 from public.prompt_chains c where c.id=p_chain_id;
$$;

create function punchline_private.prompt_chain_step_row_v9(p_step_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('model_name',m.name,'model_key',m.model_key,'supports_vision',m.supports_vision)
 from public.prompt_chain_steps s join public.llm_models m on m.id=s.model_id where s.id=p_step_id;
$$;

create function punchline_private.prompt_chain_tool_state_v9()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform punchline_private.require_admin_v1();
 return jsonb_build_object(
  'chains',coalesce((select jsonb_agg(punchline_private.prompt_chain_row_v9(c.id) order by c.archived_at nulls first,c.created_at,c.id)
    from public.prompt_chains c),'[]'::jsonb),
  'models',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'model_key',m.model_key,'supports_vision',m.supports_vision,'max_output_tokens',m.max_output_tokens) order by m.name)
    from public.llm_models m join public.llm_providers p on p.id=m.provider_id
    where m.is_active and m.archived_at is null and p.is_active and p.archived_at is null and p.slug='deepseek'
      and m.model_key in ('deepseek-flash','deepseek-v4-pro')),'[]'::jsonb),
  'mix_size',punchline_private.prompt_chain_mix_size_v9());
end $$;

create function punchline_private.prompt_chain_detail_v9(p_chain_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare chain jsonb;
begin
 perform punchline_private.require_admin_v1();
 if p_chain_id is null then raise exception using errcode='22023',message='PROMPT_CHAIN_ID_REQUIRED'; end if;
 chain:=punchline_private.prompt_chain_row_v9(p_chain_id);
 if chain is null then raise exception using errcode='P0002',message='PROMPT_CHAIN_NOT_FOUND'; end if;
 return jsonb_build_object('chain',chain,'steps',coalesce((select jsonb_agg(punchline_private.prompt_chain_step_row_v9(s.id) order by s.position)
   from public.prompt_chain_steps s where s.chain_id=p_chain_id),'[]'::jsonb));
end $$;

-- Raise when a change would leave the public caption app with no runnable chain.
create function punchline_private.prompt_chain_guard_mix_v9(p_before integer)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if p_before>0 and punchline_private.prompt_chain_mix_size_v9()=0 then
  raise exception using errcode='P0001',message='PROMPT_CHAIN_MIX_EMPTY'; end if;
end $$;

create function punchline_private.prompt_chain_save_v9(p_id uuid default null,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; mix_before integer; saved uuid;
begin
 perform punchline_private.require_admin_v1();
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload='{}'::jsonb
   or exists(select 1 from jsonb_each(p_payload) f where f.value='null'::jsonb) then
  raise exception using errcode='22023',message='INVALID_PROMPT_CHAIN'; end if;
 perform punchline_private.validate_record_payload_v7(p_payload,array['name','description','weight','is_active']);
 if (p_payload ? 'name' and (jsonb_typeof(p_payload->'name')<>'string' or char_length(btrim(p_payload->>'name')) not between 1 and 80))
  or (p_payload ? 'description' and (jsonb_typeof(p_payload->'description')<>'string' or char_length(p_payload->>'description')>500))
  or (p_payload ? 'weight' and (jsonb_typeof(p_payload->'weight')<>'number' or (p_payload->>'weight')::numeric<>trunc((p_payload->>'weight')::numeric)
      or (p_payload->>'weight')::numeric not between 0 and 100))
  or (p_id is null and not p_payload ? 'name')
  or exists(select 1 from jsonb_each_text(p_payload) f where f.key in ('name','description') and f.value ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f]') then
  raise exception using errcode='22023',message='INVALID_PROMPT_CHAIN'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prompt-chain-mix',0));
 mix_before:=punchline_private.prompt_chain_mix_size_v9();
 if p_id is null then
  insert into public.prompt_chains(name,description,weight,is_active)
  values(btrim(p_payload->>'name'),coalesce(p_payload->>'description',''),coalesce((p_payload->>'weight')::integer,0),coalesce((p_payload->>'is_active')::boolean,true))
  returning id into saved;
 else
  before_row:=punchline_private.prompt_chain_row_v9(p_id);
  if before_row is null then raise exception using errcode='P0002',message='PROMPT_CHAIN_NOT_FOUND'; end if;
  update public.prompt_chains c set name=case when p_payload ? 'name' then btrim(p_payload->>'name') else c.name end,
   description=case when p_payload ? 'description' then p_payload->>'description' else c.description end,
   weight=case when p_payload ? 'weight' then (p_payload->>'weight')::integer else c.weight end,
   is_active=case when p_payload ? 'is_active' then (p_payload->>'is_active')::boolean else c.is_active end,
   updated_at=clock_timestamp() where c.id=p_id returning id into saved;
 end if;
 perform punchline_private.prompt_chain_guard_mix_v9(mix_before);
 after_row:=punchline_private.prompt_chain_row_v9(saved);
 insert into public.admin_record_audit(actor_id,resource,record_id,action,before_data,after_data)
 values(auth.uid(),'prompt_chains',saved::text,case when p_id is null then 'create' else 'update' end,before_row,after_row);
 return after_row;
end $$;

create function punchline_private.prompt_chain_delete_v9(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row jsonb; mix_before integer;
begin
 perform punchline_private.require_admin_v1();
 if p_id is null then raise exception using errcode='22023',message='PROMPT_CHAIN_ID_REQUIRED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prompt-chain-mix',0));
 mix_before:=punchline_private.prompt_chain_mix_size_v9();
 select jsonb_build_object('chain',punchline_private.prompt_chain_row_v9(p_id),'steps',coalesce((select jsonb_agg(to_jsonb(s) order by s.position)
   from public.prompt_chain_steps s where s.chain_id=p_id),'[]'::jsonb)) into before_row;
 if before_row->'chain' is null or before_row->'chain'='null'::jsonb then raise exception using errcode='P0002',message='PROMPT_CHAIN_NOT_FOUND'; end if;
 delete from public.prompt_chain_steps s where s.chain_id=p_id;
 delete from public.prompt_chains c where c.id=p_id;
 perform punchline_private.prompt_chain_guard_mix_v9(mix_before);
 insert into public.admin_record_audit(actor_id,resource,record_id,action,before_data,after_data)
 values(auth.uid(),'prompt_chains',p_id::text,'delete',before_row,jsonb_build_object('deleted',true));
 return jsonb_build_object('id',p_id,'deleted',true);
end $$;

create function punchline_private.prompt_chain_step_save_v9(p_chain_id uuid,p_id uuid default null,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; mix_before integer; saved uuid; next_position integer;
begin
 perform punchline_private.require_admin_v1();
 if p_chain_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload='{}'::jsonb
   or exists(select 1 from jsonb_each(p_payload) f where f.value='null'::jsonb) then
  raise exception using errcode='22023',message='INVALID_PROMPT_CHAIN_STEP'; end if;
 perform punchline_private.validate_record_payload_v7(p_payload,array['name','system_prompt','model_id','temperature','max_output_tokens','is_active']);
 if (p_payload ? 'name' and (jsonb_typeof(p_payload->'name')<>'string' or char_length(btrim(p_payload->>'name')) not between 1 and 100))
  or (p_payload ? 'system_prompt' and (jsonb_typeof(p_payload->'system_prompt')<>'string' or char_length(btrim(p_payload->>'system_prompt')) not between 1 and 4000))
  or (p_payload ? 'model_id' and jsonb_typeof(p_payload->'model_id')<>'string')
  or (p_payload ? 'temperature' and (jsonb_typeof(p_payload->'temperature')<>'number' or (p_payload->>'temperature')::numeric not between 0 and 2))
  or (p_payload ? 'max_output_tokens' and (jsonb_typeof(p_payload->'max_output_tokens')<>'number'
      or (p_payload->>'max_output_tokens')::numeric<>trunc((p_payload->>'max_output_tokens')::numeric) or (p_payload->>'max_output_tokens')::numeric not between 128 and 4096))
  or (p_id is null and not(p_payload ?& array['name','system_prompt','model_id']))
  or exists(select 1 from jsonb_each_text(p_payload) f where f.key in ('name','system_prompt') and f.value ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f]') then
  raise exception using errcode='22023',message='INVALID_PROMPT_CHAIN_STEP'; end if;
 if p_payload ? 'model_id' and not exists(select 1 from public.llm_models m join public.llm_providers p on p.id=m.provider_id
   where m.id=(p_payload->>'model_id')::uuid and m.is_active and m.archived_at is null and p.is_active and p.archived_at is null
     and p.slug='deepseek' and m.model_key in ('deepseek-flash','deepseek-v4-pro')) then
  raise exception using errcode='22023',message='INVALID_PROMPT_CHAIN_MODEL'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prompt-chain-mix',0));
 if not exists(select 1 from public.prompt_chains c where c.id=p_chain_id) then raise exception using errcode='P0002',message='PROMPT_CHAIN_NOT_FOUND'; end if;
 mix_before:=punchline_private.prompt_chain_mix_size_v9();
 if p_id is null then
  select coalesce(max(s.position),0)+1 into next_position from public.prompt_chain_steps s where s.chain_id=p_chain_id;
  if next_position>8 then raise exception using errcode='P0001',message='PROMPT_CHAIN_STEP_LIMIT'; end if;
  insert into public.prompt_chain_steps(chain_id,position,name,system_prompt,model_id,temperature,max_output_tokens,is_active)
  values(p_chain_id,next_position,btrim(p_payload->>'name'),btrim(p_payload->>'system_prompt'),(p_payload->>'model_id')::uuid,
   coalesce((p_payload->>'temperature')::numeric,0.8),coalesce((p_payload->>'max_output_tokens')::integer,1024),coalesce((p_payload->>'is_active')::boolean,true))
  returning id into saved;
 else
  before_row:=punchline_private.prompt_chain_step_row_v9(p_id);
  if before_row is null or before_row->>'chain_id'<>p_chain_id::text then raise exception using errcode='P0002',message='PROMPT_CHAIN_STEP_NOT_FOUND'; end if;
  update public.prompt_chain_steps s set name=case when p_payload ? 'name' then btrim(p_payload->>'name') else s.name end,
   system_prompt=case when p_payload ? 'system_prompt' then btrim(p_payload->>'system_prompt') else s.system_prompt end,
   model_id=case when p_payload ? 'model_id' then (p_payload->>'model_id')::uuid else s.model_id end,
   temperature=case when p_payload ? 'temperature' then (p_payload->>'temperature')::numeric else s.temperature end,
   max_output_tokens=case when p_payload ? 'max_output_tokens' then (p_payload->>'max_output_tokens')::integer else s.max_output_tokens end,
   is_active=case when p_payload ? 'is_active' then (p_payload->>'is_active')::boolean else s.is_active end,
   updated_at=clock_timestamp() where s.id=p_id returning id into saved;
 end if;
 update public.prompt_chains c set updated_at=clock_timestamp() where c.id=p_chain_id;
 perform punchline_private.prompt_chain_guard_mix_v9(mix_before);
 after_row:=punchline_private.prompt_chain_step_row_v9(saved);
 insert into public.admin_record_audit(actor_id,resource,record_id,action,before_data,after_data)
 values(auth.uid(),'prompt_chain_steps',saved::text,case when p_id is null then 'create' else 'update' end,before_row,after_row);
 return after_row;
end $$;

create function punchline_private.prompt_chain_step_delete_v9(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row jsonb; mix_before integer; chain uuid;
begin
 perform punchline_private.require_admin_v1();
 if p_id is null then raise exception using errcode='22023',message='PROMPT_CHAIN_STEP_ID_REQUIRED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prompt-chain-mix',0));
 mix_before:=punchline_private.prompt_chain_mix_size_v9();
 select to_jsonb(s),s.chain_id into before_row,chain from public.prompt_chain_steps s where s.id=p_id;
 if before_row is null then raise exception using errcode='P0002',message='PROMPT_CHAIN_STEP_NOT_FOUND'; end if;
 delete from public.prompt_chain_steps s where s.id=p_id;
 -- Close the gap in one statement; uniqueness is checked at statement end.
 update public.prompt_chain_steps s set position=o.n,updated_at=clock_timestamp()
 from(select x.id,row_number() over(order by x.position,x.id)::integer n from public.prompt_chain_steps x where x.chain_id=chain) o
 where s.id=o.id and s.position<>o.n;
 update public.prompt_chains c set updated_at=clock_timestamp() where c.id=chain;
 perform punchline_private.prompt_chain_guard_mix_v9(mix_before);
 insert into public.admin_record_audit(actor_id,resource,record_id,action,before_data,after_data)
 values(auth.uid(),'prompt_chain_steps',p_id::text,'delete',before_row,jsonb_build_object('deleted',true));
 return punchline_private.prompt_chain_detail_v9(chain);
end $$;

create function punchline_private.prompt_chain_step_reorder_v9(p_chain_id uuid,p_step_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_order jsonb; after_order jsonb;
begin
 perform punchline_private.require_admin_v1();
 if p_chain_id is null or p_step_ids is null or cardinality(p_step_ids) not between 1 and 8
   or array_position(p_step_ids,null) is not null or (select count(distinct x) from unnest(p_step_ids) x)<>cardinality(p_step_ids) then
  raise exception using errcode='22023',message='INVALID_STEP_ORDER'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prompt-chain-mix',0));
 if not exists(select 1 from public.prompt_chains c where c.id=p_chain_id) then raise exception using errcode='P0002',message='PROMPT_CHAIN_NOT_FOUND'; end if;
 -- The submitted list must be exactly the chain's current steps (no stale view).
 if (select count(*) from public.prompt_chain_steps s where s.chain_id=p_chain_id)<>cardinality(p_step_ids)
   or exists(select 1 from unnest(p_step_ids) x where not exists(select 1 from public.prompt_chain_steps s where s.id=x and s.chain_id=p_chain_id)) then
  raise exception using errcode='22023',message='STALE_STEP_ORDER'; end if;
 select jsonb_agg(s.id order by s.position) into before_order from public.prompt_chain_steps s where s.chain_id=p_chain_id;
 update public.prompt_chain_steps s set position=o.n::integer,updated_at=clock_timestamp()
 from unnest(p_step_ids) with ordinality o(id,n) where s.id=o.id and s.position<>o.n;
 update public.prompt_chains c set updated_at=clock_timestamp() where c.id=p_chain_id;
 select jsonb_agg(s.id order by s.position) into after_order from public.prompt_chain_steps s where s.chain_id=p_chain_id;
 if after_order is distinct from before_order then
  insert into public.admin_record_audit(actor_id,resource,record_id,action,before_data,after_data)
  values(auth.uid(),'prompt_chains',p_chain_id::text,'reorder',jsonb_build_object('step_order',before_order),jsonb_build_object('step_order',after_order));
 end if;
 return punchline_private.prompt_chain_detail_v9(p_chain_id);
end $$;

-- Freeze one specific chain for an administrator's test generation. It reuses
-- the owner-bound Week 7 selection table, so attach/begin/finish telemetry and
-- the normal five-per-day generation quota all apply unchanged.
create function punchline_private.resolve_chain_runtime_v9(p_chain_id uuid,p_style text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); selected_chain public.prompt_chains%rowtype; configuration jsonb; token uuid; active_steps integer;
begin
 perform punchline_private.require_admin_v1();
 if p_chain_id is null or p_style is null or p_style not in ('dry','chaotic','wholesome','wordplay','roast') then
  raise exception using errcode='22023',message='INVALID_GENERATION_STYLE'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('runtime-selection:'||caller::text,0));
 if (select count(*) from punchline_private.runtime_selections_v7 s where s.user_id=caller and s.created_at>=now()-interval '1 day')>=50 then
  raise exception using errcode='P0001',message='RUNTIME_SELECTION_LIMIT_REACHED'; end if;
 select c.* into selected_chain from public.prompt_chains c where c.id=p_chain_id and c.archived_at is null;
 if not found then raise exception using errcode='P0002',message='PROMPT_CHAIN_NOT_FOUND'; end if;
 select count(*) into active_steps from public.prompt_chain_steps s where s.chain_id=p_chain_id and s.is_active;
 if active_steps not between 1 and 8 or exists(select 1 from public.prompt_chain_steps s join public.llm_models m on m.id=s.model_id join public.llm_providers p on p.id=m.provider_id
    where s.chain_id=p_chain_id and s.is_active and (not m.is_active or m.archived_at is not null or not p.is_active or p.archived_at is not null
      or p.slug<>'deepseek' or m.model_key not in ('deepseek-flash','deepseek-v4-pro'))) then
  raise exception using errcode='P0001',message='PROMPT_CHAIN_NOT_RUNNABLE'; end if;
 select jsonb_build_object('chain',jsonb_build_object('id',selected_chain.id,'name',selected_chain.name),'tool','prompt-chain-tool-v9',
  'steps',(select jsonb_agg(jsonb_build_object('id',s.id,'position',s.position,'name',s.name,'system_prompt',s.system_prompt,
    'provider_slug',p.slug,'model_id',m.id,'model_key',m.model_key,'supports_vision',m.supports_vision,'temperature',s.temperature,
    'max_output_tokens',least(s.max_output_tokens,m.max_output_tokens)) order by s.position)
    from public.prompt_chain_steps s join public.llm_models m on m.id=s.model_id join public.llm_providers p on p.id=m.provider_id where s.chain_id=selected_chain.id and s.is_active)) into configuration;
 insert into punchline_private.runtime_selections_v7(user_id,style,snapshot) values(caller,p_style,configuration) returning id into token;
 return configuration||jsonb_build_object('config_token',token);
end $$;

-- Media produced by one chain: real generation rows linked through the frozen
-- runtime request, with their captions, image and recorded step outputs.
create function punchline_private.prompt_chain_media_v9(p_chain_id uuid,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform punchline_private.require_admin_v1();
 if p_chain_id is null or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 100000 then
  raise exception using errcode='22023',message='INVALID_MEDIA_PAGE'; end if;
 return jsonb_build_object(
  'chain_id',p_chain_id,'limit',p_limit,'offset',p_offset,
  'total',(select count(*) from public.generation_requests r where r.prompt_chain_id=p_chain_id),
  'rows',coalesce((select jsonb_agg(x.row order by x.created_at desc,x.id) from(
   select r.id,r.created_at,jsonb_build_object('request_id',r.id,'generation_id',g.id,'created_at',g.created_at,'completed_at',g.completed_at,
    'status',g.status,'style',g.style,'prompt',g.prompt,'model',g.model,'chain_name',r.chain_name,
    'via_tool',coalesce(r.config_snapshot->>'tool','')='prompt-chain-tool-v9','user_email',u.email,
    'image',jsonb_build_object('id',i.id,'title',i.title,'src',i.src,'alt',i.alt,'uploaded',i.storage_path is not null),
    'captions',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'content',c.content,'position',c.position,'deleted_at',c.deleted_at,
       'laughs',(select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1),
       'groans',(select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=-1)) order by c.position)
      from public.captions c where c.generation_id=g.id),'[]'::jsonb),
    'steps',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'kind',l.kind,'step_id',l.step_id,'step_name',l.step_name,'attempt',l.attempt,
       'status',l.status,'output',l.output,'error',l.error,'duration_ms',l.duration_ms,'prompt_tokens',l.prompt_tokens,'completion_tokens',l.completion_tokens) order by l.created_at,case l.kind when 'image_assessment' then 0 when 'chain_step' then 1 else 2 end,
       (select (x->>'position')::integer from jsonb_array_elements(r.config_snapshot->'steps') x where x->>'id'=l.step_id::text),l.attempt,l.id)
      from public.llm_responses l where l.generation_request_id=r.id),'[]'::jsonb)) as row
   from public.generation_requests r join public.caption_generations g on g.id=r.generation_id
    join public.caption_images i on i.id=g.image_id join auth.users u on u.id=r.user_id
   where r.prompt_chain_id=p_chain_id order by r.created_at desc,r.id limit p_limit offset p_offset) x),'[]'::jsonb));
end $$;

-- Narrow SECURITY INVOKER public API. Private helpers have no client grant.
create function public.prompt_chain_tool_state_v9() returns jsonb language sql stable security invoker set search_path='' as $$ select punchline_private.prompt_chain_tool_state_v9(); $$;
create function public.prompt_chain_detail_v9(p_chain_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select punchline_private.prompt_chain_detail_v9(p_chain_id); $$;
create function public.prompt_chain_save_v9(p_id uuid default null,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select punchline_private.prompt_chain_save_v9(p_id,p_payload); $$;
create function public.prompt_chain_delete_v9(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select punchline_private.prompt_chain_delete_v9(p_id); $$;
create function public.prompt_chain_step_save_v9(p_chain_id uuid,p_id uuid default null,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select punchline_private.prompt_chain_step_save_v9(p_chain_id,p_id,p_payload); $$;
create function public.prompt_chain_step_delete_v9(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select punchline_private.prompt_chain_step_delete_v9(p_id); $$;
create function public.prompt_chain_step_reorder_v9(p_chain_id uuid,p_step_ids uuid[]) returns jsonb language sql security invoker set search_path='' as $$ select punchline_private.prompt_chain_step_reorder_v9(p_chain_id,p_step_ids); $$;
create function public.resolve_chain_runtime_v9(p_chain_id uuid,p_style text) returns jsonb language sql security invoker set search_path='' as $$ select punchline_private.resolve_chain_runtime_v9(p_chain_id,p_style); $$;
create function public.prompt_chain_media_v9(p_chain_id uuid,p_limit integer default 20,p_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select punchline_private.prompt_chain_media_v9(p_chain_id,p_limit,p_offset); $$;

revoke all on function
 punchline_private.prompt_chain_public_eligible_v9(uuid),punchline_private.prompt_chain_mix_size_v9(),
 punchline_private.prompt_chain_row_v9(uuid),punchline_private.prompt_chain_step_row_v9(uuid),punchline_private.prompt_chain_guard_mix_v9(integer),
 punchline_private.prompt_chain_tool_state_v9(),punchline_private.prompt_chain_detail_v9(uuid),punchline_private.prompt_chain_save_v9(uuid,jsonb),
 punchline_private.prompt_chain_delete_v9(uuid),punchline_private.prompt_chain_step_save_v9(uuid,uuid,jsonb),punchline_private.prompt_chain_step_delete_v9(uuid),
 punchline_private.prompt_chain_step_reorder_v9(uuid,uuid[]),punchline_private.resolve_chain_runtime_v9(uuid,text),punchline_private.prompt_chain_media_v9(uuid,integer,integer),
 public.prompt_chain_tool_state_v9(),public.prompt_chain_detail_v9(uuid),public.prompt_chain_save_v9(uuid,jsonb),public.prompt_chain_delete_v9(uuid),
 public.prompt_chain_step_save_v9(uuid,uuid,jsonb),public.prompt_chain_step_delete_v9(uuid),public.prompt_chain_step_reorder_v9(uuid,uuid[]),
 public.resolve_chain_runtime_v9(uuid,text),public.prompt_chain_media_v9(uuid,integer,integer)
 from public,anon,authenticated,service_role;
-- Invoker wrappers need EXECUTE on the gated implementation they call; each
-- implementation's first statement is require_admin_v1().
grant execute on function
 punchline_private.prompt_chain_tool_state_v9(),punchline_private.prompt_chain_detail_v9(uuid),punchline_private.prompt_chain_save_v9(uuid,jsonb),
 punchline_private.prompt_chain_delete_v9(uuid),punchline_private.prompt_chain_step_save_v9(uuid,uuid,jsonb),punchline_private.prompt_chain_step_delete_v9(uuid),
 punchline_private.prompt_chain_step_reorder_v9(uuid,uuid[]),punchline_private.resolve_chain_runtime_v9(uuid,text),punchline_private.prompt_chain_media_v9(uuid,integer,integer),
 public.prompt_chain_tool_state_v9(),public.prompt_chain_detail_v9(uuid),public.prompt_chain_save_v9(uuid,jsonb),public.prompt_chain_delete_v9(uuid),
 public.prompt_chain_step_save_v9(uuid,uuid,jsonb),public.prompt_chain_step_delete_v9(uuid),public.prompt_chain_step_reorder_v9(uuid,uuid[]),
 public.resolve_chain_runtime_v9(uuid,text),public.prompt_chain_media_v9(uuid,integer,integer)
 to authenticated;

notify pgrst,'reload schema';
commit;
