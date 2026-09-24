import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCommand, readOutput } from '../src/enricher/whisper'

describe('buildCommand', () => {
  it('substitui os marcadores', () => {
    const cmd = buildCommand('whisper {input} --model {model} --language {lang} --output_dir {outdir}', 'a.wav', '/saida')
    expect(cmd).toEqual(['whisper', 'a.wav', '--model', 'small', '--language', 'pt', '--output_dir', '/saida'])
  })

  it('preserva caminho com espaco entre aspas', () => {
    const cmd = buildCommand('whisper "{input}" --output_dir "{outdir}"', 'C:\\meus videos\\a.wav', 'C:\\saida final')
    expect(cmd).toEqual(['whisper', 'C:\\meus videos\\a.wav', '--output_dir', 'C:\\saida final'])
  })

  it('funciona com a interface do whisper.cpp', () => {
    const cmd = buildCommand('whisper-cli -m modelo.bin -l {lang} -otxt -f "{input}"', '/tmp/a.wav', '/tmp')
    expect(cmd).toEqual(['whisper-cli', '-m', 'modelo.bin', '-l', 'pt', '-otxt', '-f', '/tmp/a.wav'])
  })
})

describe('readOutput', () => {
  it('prefere o .txt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w-'))
    await writeFile(join(dir, 'a.txt'), '  falou\n isso aqui  ')
    expect(await readOutput(dir)).toBe('falou isso aqui')
  })

  it('cai para o .srt e converte', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w-'))
    await writeFile(join(dir, 'a.srt'), '1\n00:00:00,000 --> 00:00:01,000\nbom dia')
    expect(await readOutput(dir)).toBe('bom dia')
  })

  it('devolve vazio quando nao ha saida', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w-'))
    expect(await readOutput(dir)).toBe('')
  })
})
