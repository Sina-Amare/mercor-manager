begin;

alter table public.tasks
  add column if not exists submission_prompt text not null default '',
  add column if not exists submission_dsp text not null default '',
  add column if not exists submission_final_answer text not null default '',
  add column if not exists submission_notes text not null default '',
  add column if not exists studio_result text not null default '';

comment on column public.tasks.submission_prompt is
  'Collaborative prompt text, editable after the member selects SWF or SWOF.';
comment on column public.tasks.submission_dsp is
  'Collaborative DSP text, editable after the member selects SWF or SWOF.';
comment on column public.tasks.submission_final_answer is
  'Collaborative final answer, editable after the member selects SWF or SWOF.';
comment on column public.tasks.submission_notes is
  'Collaborative submission notes, editable after the member selects SWF or SWOF.';
comment on column public.tasks.studio_result is
  'Separate studio result text, editable after the member selects SWF or SWOF.';

commit;
