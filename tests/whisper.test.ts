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

describe('whisper em paralelo', () => {
  it('passa as threads para o whisper-ctranslate2 quando o template nao diz', () => {
    const cmd = buildCommand('"C:\\py\\whisper-ctranslate2.exe" "{input}" --model small', 'a.wav', 'o', 4)
    expect(cmd.slice(-2)).toEqual(['--threads', '4'])
    expect(buildCommand('whisper-ctranslate2 {input} --threads {threads}', 'a.wav', 'o', 3)).toEqual(['whisper-ctranslate2', 'a.wav', '--threads', '3'])
    expect(buildCommand('whisper-cli -f {input}', 'a.wav', 'o', 4)).toEqual(['whisper-cli', '-f', 'a.wav'])
  })
  it('divide os nucleos entre os processos', async () => {
    const { paralelismo } = await import('../src/enricher/whisper')
    expect(paralelismo(16)).toEqual({ processos: 4, threads: 4 })
    expect(paralelismo(8)).toEqual({ processos: 2, threads: 4 })
    expect(paralelismo(4)).toEqual({ processos: 1, threads: 4 })
    expect(paralelismo(2)).toEqual({ processos: 1, threads: 2 })
  })
})

describe('andamento do whisper', () => {
  it('ritmo medio e previsao', async () => {
    const { progresso } = await import('../src/enricher/whisper')
    expect(progresso(10, 70, 2, 300_000)).toEqual({ video: '10/70', emParalelo: 2, ritmo: '30s por vídeo', faltam: '~30min' })
    expect(progresso(70, 70, 1, 2_100_000).faltam).toBe('0')
  })
})
