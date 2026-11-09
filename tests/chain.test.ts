import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCaptions, parseIntermediate, stepSystemPrompt, stepUserPrompt, type RunStep } from '../lib/chain-prompts'
import { runChain, ChainRunError, type Observer } from '../lib/chain-runner'

const step = (n: number, vision = true): RunStep => ({ id: `00000000-0000-4000-8000-00000000000${n}`, position: n, name: `Step ${n}`,
  instruction: `Instruction ${n}`, model: 'deepseek-flash', temperature: 0.7, maxOutputTokens: 512, supportsVision: vision })

test('final step prompt enforces the three-caption contract; earlier steps return output text', () => {
  const steps = [step(1), step(2), step(3)]
  const first = stepSystemPrompt('Demo', steps[0], 0, 3, 'dry')
  const last = stepSystemPrompt('Demo', steps[2], 2, 3, 'dry')
  assert.match(first, /step 1 of 3/); assert.match(first, /"output"/); assert.doesNotMatch(first, /"captions"/)
  assert.match(last, /exactly three distinct captions/); assert.match(last, /"captions"/); assert.match(last, /Instruction 3/)
})

test('step 1 gets the image; later steps get only the previous output', () => {
  const first = JSON.parse(stepUserPrompt(0, { context: 'finals', imageText: 'A cat', photoAttached: false }))
  assert.equal(first.image, 'A cat'); assert.equal(first.context, 'finals')
  const second = JSON.parse(stepUserPrompt(1, { context: 'finals', imageText: 'A cat', previousOutput: 'desc', photoAttached: false }))
  assert.deepEqual(second, { previous_step_output: 'desc', context: 'finals' })
})

test('output validators reject malformed, overlong and duplicate output', () => {
  assert.equal(parseIntermediate('{"output":"  hello "}'), 'hello')
  assert.equal(parseIntermediate('{"output":""}'), null)
  assert.equal(parseIntermediate('not json'), null)
  assert.equal(parseIntermediate(JSON.stringify({ output: 'x'.repeat(1501) })), null)
  assert.deepEqual(parseCaptions('{"captions":["One funny caption","Two funny caption","Three funny caption"]}'), ['One funny caption', 'Two funny caption', 'Three funny caption'])
  assert.equal(parseCaptions('{"captions":["a","b","c"]}'), null)
  assert.equal(parseCaptions('{"captions":["Same caption here","same caption here","Other caption here"]}'), null)
  assert.equal(parseCaptions('{"captions":["one two three four five six seven eight nine ten eleven","b caption","c caption"]}'), null)
  assert.equal(parseCaptions('{"captions":["Only two here","Second one here"]}'), null)
})

function fakeObserver() {
  const calls: { kind: string; stepId: string | null; user: string; status?: string; output?: string | null }[] = []
  const observer: Observer = {
    async start(call) { calls.push({ kind: call.kind, stepId: call.stepId, user: call.userPrompt }); return String(calls.length - 1) },
    async finish(id, result) { Object.assign(calls[Number(id)], { status: result.status, output: result.output }) },
  }
  return { calls, observer }
}

function mockFetch(contents: string[]) {
  const bodies: Record<string, unknown>[] = []
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    bodies.push(JSON.parse(init.body))
    const content = contents.shift() ?? ''
    return new Response(JSON.stringify({ model: 'deepseek-flash', usage: { prompt_tokens: 10, completion_tokens: 5 },
      choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 })
  }) as typeof fetch
  return bodies
}

test('runChain pipes each output into the next step and records every call', async () => {
  const bodies = mockFetch(['{"output":"A coffee cup by a laptop."}', '{"output":"The coffee is studying harder than me."}',
    '{"captions":["My coffee studies harder than me","Laptop open, brain closed","Caffeine is my study group"]}'])
  const { calls, observer } = fakeObserver()
  const result = await runChain({ apiKey: 'test', chainName: 'Demo', steps: [step(1), step(2), step(3)], style: 'dry', context: 'finals',
    imageText: 'scene', imageDataUrl: 'data:image/jpeg;base64,AAAA', observer, deadlineAt: Date.now() + 30_000 })
  assert.equal(result.captions.length, 3)
  assert.deepEqual(result.outputs.map((o) => o.name), ['Step 1', 'Step 2', 'Step 3'])
  assert.deepEqual(calls.map((c) => c.kind), ['chain_step', 'chain_step', 'captions'])
  assert.ok(calls.every((c) => c.status === 'succeeded'))
  // Only step 1 receives pixels; step 2's input is step 1's output.
  const messages = bodies.map((b) => (b.messages as { content: unknown }[])[1].content)
  assert.ok(Array.isArray(messages[0])); assert.equal(typeof messages[1], 'string')
  assert.equal(JSON.parse(messages[1] as string).previous_step_output, 'A coffee cup by a laptop.')
  assert.equal(JSON.parse(messages[2] as string).previous_step_output, 'The coffee is studying harder than me.')
  assert.doesNotMatch(calls[0].user, /base64/)
})

test('a non-vision first step gets the scene text, not pixels', async () => {
  const bodies = mockFetch(['{"captions":["Scene caption number one","Scene caption number two","Scene caption number three"]}'])
  const { observer } = fakeObserver()
  await runChain({ apiKey: 'test', chainName: 'One', steps: [step(1, false)], style: 'dry', context: 'c', imageText: 'A floating book',
    imageDataUrl: 'data:image/jpeg;base64,AAAA', observer, deadlineAt: Date.now() + 30_000 })
  const content = (bodies[0].messages as { content: unknown }[])[1].content
  assert.equal(typeof content, 'string'); assert.equal(JSON.parse(content as string).image, 'A floating book')
})

test('invalid final output is retried once, then fails without fabricated captions', async () => {
  mockFetch(['{"captions":["bad"]}', '{"captions":["still bad"]}'])
  const { calls, observer } = fakeObserver()
  await assert.rejects(runChain({ apiKey: 'test', chainName: 'One', steps: [step(1)], style: 'dry', context: 'c', imageText: 's', observer, deadlineAt: Date.now() + 30_000 }),
    (error: unknown) => error instanceof ChainRunError && error.code === 'invalid_output')
  assert.equal(calls.length, 2); assert.ok(calls.every((c) => c.status === 'failed' && c.output))
})

test('provider HTTP errors map to safe codes', async () => {
  globalThis.fetch = (async () => new Response('{}', { status: 402 })) as typeof fetch
  const { observer } = fakeObserver()
  await assert.rejects(runChain({ apiKey: 'k', chainName: 'One', steps: [step(1)], style: 'dry', context: 'c', imageText: 's', observer, deadlineAt: Date.now() + 30_000 }),
    (error: unknown) => error instanceof ChainRunError && error.code === 'provider_credit')
})
