// Copia para /public o que as bibliotecas carregam em tempo de execução (worker do pdf.js, fontes do Excalidraw),
// para nada ser buscado de CDN: nenhum dado sai do servidor (SDD §8).
import { cpSync } from 'node:fs'

cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdf.worker.min.mjs')
cpSync('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'public/fonts', { recursive: true })
