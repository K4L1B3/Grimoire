# Grimório VTT — SDD

Oct 29, 2026 · @Luiz

Um VTT open source, self-hosted e gratuito que junta wiki do mundo, fichas em PDF editáveis e tabuleiro com iluminação num só app Next.js, para acabar com o pula-pula entre LegendKeeper, Kami e Roll20.

## 1. Visão e escopo

O Grimório resolve uma dor só: hoje uma sessão exige LegendKeeper para a lore, Kami para a ficha customizada e Roll20 para o mapa. O app junta as três coisas, com uma interface bonita e simples. Nome é provisório.

**Público:** mestres e grupos pequenos (até \~8 pessoas por mesa) que rodam sistemas próprios ou híbridos e querem hospedar o próprio servidor. Primeiro usuário: a mesa do Luiz, com a ficha mista Masmorra Cruel + D&D + companheiro animal.

**Objetivos do v1**

1. Wiki do mundo com árvore de páginas, editor rico, links entre páginas, blocos secretos do mestre e mapas com pins.
2. Ficha a partir de qualquer PDF: o mestre desenha áreas de campo em cima do PDF e os jogadores preenchem dentro do app.
3. Tabuleiro jogável: cenas, grid, tokens, camada do mestre, iluminação dinâmica e névoa de guerra.
4. Rolagem de dados com chat por personagem e, como extra, dado 3D animado na mesa.
5. Tudo em tempo real, rodando com um único `docker compose up` numa VPS.

**Fora do escopo (v1)**

- Voz e vídeo: o grupo continua no Discord.
- Regras de sistema embutidas (automação de combate, iniciativa com regras de D&D). O app é agnóstico de sistema.
- Marketplace, assinaturas ou qualquer monetização.
- App mobile nativo. O alvo é desktop; celular só precisa funcionar para ficha, wiki e dados.
- Paridade com LegendKeeper ou Foundry. O alvo é cobrir o uso real da mesa, não todas as features deles.

**Critério de sucesso:** uma sessão inteira jogada só no Grimório + Discord, sem abrir Kami, Roll20 ou LegendKeeper.

## Simplicidade é o diferencial

O Grimório só vence o Foundry e o Roll20 se der para sair do zero e jogar em 15 minutos, sem tutorial. Toda feature deste SDD obedece às regras abaixo; uma feature que não cabe nelas fica de fora ou vai para "Mais opções".

**Regras de produto**

1. **Padrão que funciona:** toda feature roda sem configurar nada. Grid, luz, visão e combate já vêm com valores sensatos; configurar é opcional.
2. **Opção avançada escondida:** cada painel mostra no máximo 3–4 controles; o resto fica atrás de "Mais opções". O jogador nunca vê uma tela de configuração.
3. **Editar no lugar:** clica no token, na ficha ou no pin e edita ali mesmo, sem janelas de propriedades com abas.
4. **Sem módulos e plugins:** tudo vem embutido. Nada de instalar sistema, módulo ou dependência para ter ficha, dado ou luz.
5. **Linguagem de mesa:** "mestre", "jogador", "vida", "turno". Nada de "actor", "compendium", "macro folder".
6. **Desfazer sempre:** Ctrl+Z em tudo que o mestre edita (paredes, pins, campos da ficha), para errar sem medo.

**O que isso muda nas features**

| Onde | Como fica simples |
| --- | --- |
| Primeiro uso | Assistente de 4 passos: nome da campanha → subir ficha (opcional) → subir mapa → subir capa (opcional). Termina com link de convite pronto para colar no Discord |
| Ficha (F2, F5) | Ao desenhar uma área, o app sugere o nome lendo o texto do PDF ao lado ("Força" → forca). O mestre só confirma. Fórmula se escreve com os nomes dos campos e um autocompletar |
| Ficha pronta | PDF que já tem campos de formulário vira ficha em 1 clique (F8) |
| Cena (T1, T3) | Arrastar a imagem para a tela cria a cena. Grid vem desligado (70 px de escala) e o token fica onde soltar; alinhar é "clique em 2 cantos de um quadrado" |
| Paredes (L1) | Ferramenta de sala: arrastar um retângulo cria as 4 paredes de uma vez; portas são um clique numa parede existente |
| Luz e névoa | Um interruptor "Modo masmorra" liga escuridão, visão e névoa com valores padrão. Ajuste fino é opcional |
| Combate (C1–C8) | Selecionar tokens → "Começar combate". Iniciativa e vida já vêm da ficha se os campos tiverem os nomes sugeridos |
| Dados | Barra de dados sempre visível com d4–d20; digitar fórmula é opcional |
| Entrar na mesa | Jogador abre o link, faz login com Discord e cai direto na cena ativa com a ficha dele aberta |

**Métrica que decide se está simples:** uma pessoa que nunca viu o app cria campanha, monta uma ficha de 10 campos e uma cena com paredes em menos de 15 minutos, sem ajuda. Isso é testado ao fim de cada fase.

## 2. Arquitetura

O projeto é um monolito modular num monorepo Turborepo: `apps/web` (Next.js, sem servidor customizado) e `apps/realtime` (Node com Socket.IO e Hocuspocus), compartilhando o domínio em `packages/core`. Um `docker compose up` sobe tudo, e um proxy (Caddy) coloca os dois no mesmo domínio para o cookie de sessão valer nos dois.

&#91;embedded content: arquitetura · um processo, três canais, um núcleo de permissões\]

Os três canais chamam o mesmo núcleo, então uma regra de permissão escrita uma vez vale para página, socket e documento colaborativo.

**Estrutura de pastas do app**

```
apps/
  web/              Next.js: rotas (campanha, wiki, mesa, fichas), Server Actions, uploads
  realtime/         Node: Socket.IO em /rt + Hocuspocus em /collab
packages/
  core/             can(), schemas Zod, serviços de domínio, dados, fórmulas, visibilidade
  db/               schema Drizzle e migrações
  ui/               componentes shadcn/ui, tema e tokens de design
docker-compose.yml  web + realtime + postgres + caddy
turbo.json
```

## 3. Domínio e permissões

Tudo pertence a uma **Campanha**. Quem entra numa campanha tem um papel nela, e o servidor decide o que cada um recebe. O cliente nunca recebe dado que não pode ver, mesmo escondido na UI.

**Entidades**

| Entidade | Campos principais | Observação |
| --- | --- | --- |
| User | id, nome, email, avatar | Login por email/senha e Discord OAuth |
| Campaign | id, nome, capa, ownerId, inviteCode | Um mestre dono; pode ter co-mestres |
| Membership | campaignId, userId, role | role: `gm`, `player`, `observer` |
| Page | id, parentId, título, ícone, ordem, visibilidade | Conteúdo em documento Yjs próprio |
| SecretBlock | id, pageId, visibleTo\[\] | Documento Yjs separado, carregado só por quem pode ver |
| WorldMap | id, pageId, assetId | Imagem de mapa dentro de uma página |
| Pin | id, mapId ou sceneId, x, y, ícone ou imagem, nota, pageId?, visibilidade, escondidoPelaNévoa | Coordenadas normalizadas (0–1) |
| SheetTemplate | id, nome, pdfAssetId, fields\[\] | O "molde" desenhado pelo mestre |
| Sheet | id, templateId, ownerIds\[\], values{} | Uma ficha preenchida |
| Actor | id, nome, avatar, sheetId?, ownerIds\[\] | Personagem, NPC ou companheiro animal |
| Scene | id, nome, assetId, grid, dimensões, ativa | Um mapa jogável |
| Token | id, sceneId, actorId?, x, y, tamanho, camada, visão, luz | Camada `tokens` ou `gm` |
| Wall | id, sceneId, pontos, tipo, estado | tipo: parede, porta, janela |
| Light | id, sceneId, x, y, raio claro, raio penumbra, cor | Luz fixa do cenário |
| ChatMessage | id, campaignId, autor, actorId?, texto, roll?, visibilidade | visibilidade: pública, só mestre, só eu |
| Asset | id, campaignId, tipo, chave no storage, tamanho | Imagens, PDFs, mapas |

**Matriz de permissões**

| Ação | Mestre | Jogador | Observador |
| --- | --- | --- | --- |
| Criar e editar páginas da wiki | Sim | Texto e mapa: só leitura. Quadro e linha do tempo: se o mestre liberar | Não |
| Criar notas pessoais (só o dono vê, nem o mestre; ficam fora da wiki) | Sim (notas ocultas; pode mostrar aos jogadores) | Sim | Sim |
| Criar pastas da mesa no painel de Notas (são pastas da wiki; todos veem e acompanham ao vivo) | Sim | Não | Não |
| Organizar as próprias notas em pastas pessoais (não mudam a wiki) | Sim | Sim | Sim |
| Ver blocos secretos | Sim | Só os marcados para ele | Não |
| Criar e editar molde de ficha | Sim | Não | Não |
| Preencher ficha | Todas | Só as suas | Não |
| Criar cena, paredes e luzes | Sim | Não | Não |
| Colocar, mover, configurar e tirar token | Todos | Só os seus (posição por movimento, com colisão; camada e ficha vinculada são do mestre) | Não |
| Ver camada do mestre | Sim | Não | Não |
| Ver através da névoa | Sim (com alternância para "ver como jogador") | Só o que seus tokens enxergam | Igual ao jogador |
| Rolar dados | Público, oculto ou privado | Público ou privado | Não |

**Regra de ouro:** toda leitura passa por uma função `can(user, action, resource)` no servidor. Ela é a única fonte de verdade e tem testes unitários para cada linha da matriz acima.

## 4. Módulo Wiki (estilo LegendKeeper)

A wiki é o lugar da lore: uma árvore de páginas com editor colaborativo, links entre páginas e segredos que só o mestre vê. Ela substitui o LegendKeeper e também serve de "pasta" do app, então não existe gerenciador de arquivos separado.

**Features**

| ID | Feature | Comportamento esperado |
| --- | --- | --- |
| W1 | Árvore de páginas | Barra lateral com páginas aninhadas, arrastar para reordenar e mover, ícone e cor por página |
| W2 | Editor rico | Títulos, listas, tabelas, imagens, citação, divisor, callout; comando `/` para inserir blocos |
| W3 | Edição colaborativa | Duas pessoas editam a mesma página ao vivo, com cursor e nome de quem está editando |
| W4 | Links `[[ ]]` | Digitar `[[` abre busca de páginas; o link vira chip clicável; renomear a página atualiza o texto do chip |
| W5 | Backlinks | Rodapé de cada página lista as páginas que apontam para ela |
| W6 | Bloco secreto | Bloco marcado como secreto, com lista de quem vê (mestre sempre vê). Jogador sem acesso não recebe o conteúdo |
| W7 | Visibilidade da página | Página inteira oculta ou visível; quadro e linha do tempo também podem ser editáveis por jogadores. Página de texto ou mapa só vai para o painel de Notas da mesa se o mestre indicar |
| W8 | Mapa com pins | Página do tipo mapa: imagem com zoom e pan e pontos de interesse com ícone, imagem e nota (P1–P8), que podem levar a outras páginas |
| W9 | Busca | Busca por título e conteúdo, com atalho `Ctrl+K`, respeitando permissões |
| W10 | Templates de página | Modelos prontos: personagem, local, facção, item, evento; o mestre pode criar os seus |
| W11 | Linha do tempo | Página do tipo linha do tempo com eventos datados no calendário do mundo, cada evento linkando uma página |
| W12 | Exportar | Exportar a campanha inteira em Markdown + imagens (zip), para backup e para alimentar IA depois |

**Quadro (estilo Miro)**

Além de texto e mapa, uma página pode ser um quadro infinito para montar arcos, relações entre facções e árvores genealógicas, como os boards do LegendKeeper.

| ID | Feature | Comportamento esperado |
| --- | --- | --- |
| W13 | Página do tipo quadro | Quadro infinito com zoom e pan, criado na árvore como qualquer página |
| W14 | Elementos | Notas adesivas, texto, formas, setas e conectores, desenho livre, imagens |
| W15 | Cartões de página | Arrastar uma página da wiki para o quadro cria um cartão com título e capa; clicar abre a página; renomear atualiza o cartão |
| W16 | Colaboração ao vivo | Várias pessoas editam juntas, com cursores e nomes, via Yjs |
| W17 | Visibilidade | Quadro inteiro visível só para o mestre ou para todos; cartões de páginas que o jogador não pode ver aparecem como "página oculta" |
| W18 | Exportar | Baixar o quadro como PNG ou SVG |

**Critérios de aceite principais**

- [ ] Um jogador sem acesso a um bloco secreto não encontra o texto dele no tráfego de rede nem na busca.
- [ ] Editar a mesma página em duas abas, uma offline por 30 s, e as duas convergem sem perder texto ao reconectar.
- [ ] Renomear uma página não quebra nenhum link `[[ ]]` que aponte para ela.
- [ ] Exportar e reimportar uma campanha reproduz a árvore de páginas e os links.

**Fora do v1:** calendário com regras próprias (meses e dias customizados ficam só como texto), grafo visual de conexões, histórico de versões por página.

## 5. Módulo Fichas (estilo Kami)

O mestre sobe qualquer PDF, desenha caixas de campo em cima dele e publica como molde. Cada jogador recebe sua cópia e preenche dentro do app, com o PDF original intocado por baixo. É o que mata o Kami.

**Modo editor (mestre)**

| ID | Feature | Comportamento esperado |
| --- | --- | --- |
| F1 | Importar PDF | Upload de PDF de várias páginas; cada página vira uma camada de fundo |
| F2 | Desenhar campo | Arrastar um retângulo sobre o PDF cria um campo; mover, redimensionar, duplicar, alinhar |
| F3 | Tipos de campo | Texto curto, texto longo, número, checkbox, contador (+/−), imagem (retrato do personagem) |
| F4 | Estilo do campo | Fonte, tamanho (ou ajuste automático), alinhamento, cor |
| F5 | Nome e fórmula | Todo campo tem um nome (`forca`, `mod_forca`); campo numérico pode ter fórmula (`floor((forca-10)/2)`) e fica somente leitura. Um painel "Mapa de campos" lista cada área nomeada, seu valor e quem depende dela; esses nomes são o que o token, o chat e o painel de combate referenciam com @, e uma fórmula pode ler outra ficha do mesmo ator (@companheiro.forca) |
| F6 | Botão de rolagem | Campo pode ter uma rolagem associada (`1d20 + @mod_forca`); clicar rola no chat em nome do personagem |
| F7 | Grupos repetíveis | Uma linha de campos (ex.: inventário, magias) que o jogador pode duplicar |
| F8 | Detectar campos | Se o PDF já tiver campos de formulário (AcroForm), importar como campos prontos |

**Modo preenchimento (jogador)**

| ID | Feature | Comportamento esperado |
| --- | --- | --- |
| F9 | Preencher | Campos aparecem sobre o PDF; Tab navega entre eles; salva sozinho |
| F10 | Tempo real | Mestre e jogador veem as mudanças da mesma ficha ao vivo |
| F11 | Vínculo com ator | A ficha pertence a um ator; o token do ator mostra barras ligadas a campos (ex.: `pv_atual` / `pv_max`) |
| F12 | Várias fichas por ator | Um personagem pode ter ficha principal + ficha de companheiro animal |
| F13 | Exportar PDF | Baixar o PDF preenchido, com os valores desenhados nas posições dos campos |
| F14 | Anotação livre | Caneta e texto solto sobre a ficha, como no Kami, guardados por usuário |

**Regras técnicas**

- Posição e tamanho dos campos são guardados em fração da página (0–1), nunca em pixels. Assim a ficha funciona em qualquer zoom e tela.
- Fórmulas rodam num avaliador seguro (sem `eval`), só com operações matemáticas, `floor`, `ceil`, `min`, `max` e referências `@campo`. Dependência circular é erro visível no editor.
- Mudar o molde (adicionar ou mover campo) atualiza todas as fichas daquele molde; valores de campos removidos ficam guardados por 30 dias.

**Critérios de aceite principais**

- [ ] Montar a ficha mista Masmorra Cruel + D&D + companheiro animal só com o editor, sem tocar em código.
- [ ] Um jogador muda a Força e o modificador recalcula na tela do mestre em menos de 1 s.
- [ ] O PDF exportado abre em qualquer leitor com os valores nas posições certas.

## 6. Módulo Tabuleiro

O tabuleiro é um canvas 2D (PixiJS) com mapa de fundo, grid, tokens e uma camada do mestre. O servidor é a autoridade: cada movimento vai ao servidor, que valida e repassa só para quem pode ver.

**Cenas e tokens**

| ID | Feature | Comportamento esperado |
| --- | --- | --- |
| T1 | Cenas | Mestre cria cenas com imagem de fundo, nome e grid; uma cena é a ativa para os jogadores |
| T2 | Trocar de cena | Mestre ativa outra cena e todos os jogadores são levados a ela; mestre pode preparar cenas sem ninguém ver |
| T3 | Grid | Opcional, desligado por padrão (o tamanho continua sendo a escala da cena); quadrado, tamanho em px, deslocamento e cor ajustáveis; ferramenta para alinhar o grid ao mapa clicando em 2 cantos |
| T4 | Tokens | Arrastar imagem ou ator da barra lateral para o mapa; tamanho em células (1×1, 2×2…); posição livre, com encaixe só quando o grid está ligado |
| T5 | Barras e status | Até 2 barras por token ligadas a campos da ficha; ícones de condição (envenenado, caído…) |
| T6 | Camada do mestre | Tokens e anotações na camada `gm` não são enviados a jogadores |
| T7 | Régua | Medir distância em células e na unidade da cena (ex.: 1,5 m por quadrado) |
| T8 | Ping | Clique segurado mostra um ping animado para todos |
| T9 | Desenho livre | Pincel e formas simples para marcar áreas; apagável |
| T10 | Ordem de iniciativa | Ver painel de combate abaixo (C1–C8) |
| T11 | Mesa de som | Só o mestre importa sons e mexe na mesa; todos ouvem a mixagem da cena ativa, sem receber o nome das faixas. Música por estado (exploração, combate, vitória) com intensidade, ambientes em camadas com três níveis e efeitos de um toque por grupo, incluindo monstros e criaturas. As trocas e os loops emendam com crossfade. Cada um ajusta só o próprio volume |

**Combate: iniciativa, vida e deslocamento**

Um painel lateral de combate junta ordem de turno e vida de heróis e inimigos. Os números vêm dos campos nomeados das fichas (F5), então nada é digitado duas vezes.

| ID | Feature | Comportamento esperado |
| --- | --- | --- |
| C1 | Montar o combate | Selecionar tokens no mapa e "adicionar ao combate"; NPCs sem ficha entram com vida e iniciativa simples |
| C2 | Rolar iniciativa | Um clique rola a iniciativa de todos usando a fórmula da ficha (ex.: 1d20 + @mod\_destreza); cada rolagem sai no chat (a de combatente oculto, só para o mestre). Quem entra no meio da luta rola sem tirar a vez de ninguém; com todos rolados, o botão rerrola todos. Empate não tem regra de sistema: é sorteado, e o mestre pode editar à mão e reordenar arrastando |
| C3 | Turnos e rodadas | Botão "próximo turno" avança a vez, conta rodadas e destaca o token da vez no mapa e no painel |
| C4 | Vida no painel | Vida atual e máxima ligadas aos campos da ficha (ex.: @pv\_atual / @pv\_max); campo rápido para dano e cura ("-7", "+5") que grava direto na ficha |
| C5 | Condições | Condições com duração em rodadas (envenenado 3 rodadas) que vencem sozinhas e aparecem no token |
| C6 | Ocultar vida | Por combatente, o mestre escolhe o que os jogadores veem: valor exato, só estado (ileso, ferido, muito ferido, caído) ou nada |
| C7 | Inimigo oculto | Combatente pode ficar escondido do painel dos jogadores até o mestre revelar (emboscada) |
| C8 | Deslocamento | Ao arrastar um token, mostra a distância percorrida e o quanto resta do deslocamento do turno (campo @deslocamento); passa do limite em vermelho; regra de diagonal configurável por cena (1:1 ou 5-10-5) |

A vida oculta segue a regra de ouro: quando o mestre escolhe "só estado" ou "nada", o servidor manda apenas o rótulo ou nenhum dado, nunca o número.

**Pontos de interesse e notas**

O mesmo componente de pins serve para as cenas do tabuleiro e para os mapas da wiki (W8), então qualquer mapa ganha marcadores, imagens e notas.

| ID | Feature | Comportamento esperado |
| --- | --- | --- |
| P1 | Criar ponto de interesse | Ferramenta "pin": clique no mapa cria o ponto; arrastar move; nome e rótulo opcional visível no mapa |
| P2 | Ícone à escolha | Biblioteca de ícones pesquisável (lucide + game-icons.net, com atribuição CC BY), cor e tamanho por pin |
| P3 | Imagem como pin | Upload de qualquer imagem (retrato de NPC, baú, brasão) no lugar do ícone, com recorte redondo ou livre |
| P4 | Nota | Texto rico curto que abre ao clicar no pin; pode linkar uma página da wiki |
| P5 | Nota só do mestre | Pin ou nota marcado "só mestre": aparece para o mestre com um selo de oculto e nunca é enviado aos jogadores |
| P6 | Visibilidade por pessoa | Pin visível para todos, só mestre ou jogadores escolhidos |
| P7 | Revelar na hora | Mestre torna um pin oculto público no meio da sessão (ex.: o grupo descobriu a armadilha) |
| P8 | Pin sob a névoa | Opção por pin: pin público dentro de área ainda não vista fica escondido até um token enxergá-lo |

**Iluminação e névoa**

| ID | Feature | Comportamento esperado |
| --- | --- | --- |
| L1 | Paredes | Mestre desenha paredes como linhas encadeadas (clique, clique, Esc); encaixe nos cantos do grid, quando ligado; tipos: parede, porta, janela |
| L2 | Portas | Porta aberta deixa ver e passar; fechada bloqueia; trancada só o mestre abre. Jogador clica no ícone da porta para abrir |
| L3 | Visão por token | Cada token tem raio de visão e opção "visão no escuro"; jogador vê só o que seus tokens enxergam |
| L4 | Luzes | Luzes fixas no mapa e luz carregada pelo token (tocha); raio claro, penumbra e cor. Só o mestre ajusta luz e visão dos tokens |
| L5 | Névoa de guerra | Modo masmorra: a cena começa toda escura para os jogadores e vai se revelando conforme os tokens andam. O jogador só vê o que seus tokens enxergam agora; todo o resto é preto, inclusive onde já passou. O que foi visto fica registrado (libera pin sob a névoa). O mestre pode resetar ou revelar uma área à mão, que fica em cinza para os jogadores (sem mostrar tokens que estão lá agora) |
| L6 | Colisão | Token de jogador não atravessa parede nem porta fechada |
| L7 | Ver como jogador | Por padrão o mestre vê o mapa inteiro e todos os tokens andando em tempo real, com um véu translúcido escurecendo tudo que os jogadores não enxergam agora; pode alternar para ver pelos olhos de um token específico |

**Regras técnicas**

- Visibilidade = polígono de visão por raycasting 2D contra os segmentos de parede (algoritmo clássico da Red Blob Games), recortado pelo raio de luz ou visão.
- O polígono é calculado no cliente para desenhar; a revelação da névoa e a filtragem de tokens escondidos são calculadas no servidor, para que um jogador não receba tokens que não deveria ver.
- Movimento de token é otimista: o token anda na hora na tela de quem arrasta e o servidor confirma ou devolve.

**Critérios de aceite principais**

- [ ] Cena 4000×4000 px com 30 tokens e 10 luzes roda a 60 fps num notebook comum.
- [ ] Desenhar as paredes de uma sala de 6 cômodos leva menos de 2 minutos.
- [ ] Um token inimigo atrás de uma parede e um pin só do mestre não aparecem no tráfego de rede do jogador; o mestre vê ambos o tempo todo.

## 7. Dados e chat

Toda rolagem é feita no servidor, com gerador criptográfico, e só depois animada na tela. Assim ninguém consegue trapacear pelo console e todo mundo vê o mesmo resultado no dado 3D.

| ID | Feature | Comportamento esperado |
| --- | --- | --- |
| D1 | Notação de dados | `2d6+3`, `1d20+@mod_forca`, `4d6kh3` (manter maiores), `2d20kl1` (desvantagem), `1d6!` (explosivo), `3d6>=5` (sucessos) |
| D2 | Rolar como personagem | O chat tem um seletor de "falar como": eu, ou um dos meus atores; `@campo` puxa da ficha do ator |
| D3 | Visibilidade | Pública, oculta (só mestre) ou privada (só eu + mestre) |
| D4 | Resultado detalhado | Mensagem mostra fórmula, cada dado, dados descartados riscados, total em destaque; crítico e falha destacados |
| D5 | Macros | Botões salvos por jogador ("Ataque espada") e as rolagens vindas da ficha (F6) |
| D6 | Chat de texto | Mensagens simples, `/w nome` para sussurro, histórico paginado por campanha |
| D7 | Dado 3D | Ao rolar, dados 3D com física caem sobre o tabuleiro para todos, parando no resultado já sorteado pelo servidor; dá para desligar por usuário |
| D8 | Cor do dado | Cada jogador escolhe a cor/tema do seu dado |

**Critérios de aceite principais**

- [ ] O parser tem testes para cada notação de D1, incluindo entradas inválidas com mensagem de erro clara.
- [ ] Rolagem oculta do mestre não chega à rede dos jogadores; eles só veem "o mestre rolou dados".
- [ ] Com o dado 3D ligado, o número que o dado mostra é sempre igual ao total do chat.

## 8. Requisitos não funcionais

| Área | Requisito |
| --- | --- |
| Hospedagem | `docker compose up` sobe web + realtime + Postgres + Caddy numa VPS de 1 vCPU / 2 GB; imagem multi-arch (amd64 e arm64, para a Oracle Ampere) |
| Storage | Disco local por padrão; S3 compatível (R2, MinIO) opcional via variável de ambiente |
| Tempo real | Latência de movimento de token < 150 ms na mesma região; reconexão automática sem recarregar a página |
| Performance | Primeira carga da cena < 3 s com mapa de 5 MB; imagens convertidas para WebP no upload e sons para AAC 128 kbps com volume normalizado e índice no início, servidos em trechos de 2 MB; o servidor só fala de som quando o mestre muda algo |
| Segurança | Senhas com hash (argon2), sessão em cookie httpOnly, rate limit no login e na rolagem, validação de todo payload com Zod |
| Privacidade | Sem telemetria; nenhum dado sai do servidor do usuário |
| Acessibilidade | Navegação por teclado na wiki, ficha e chat; contraste AA; tema escuro (único no v1) |
| Idioma | Português e inglês desde o início (next-intl), textos fora do código |
| Dispositivos | Desktop é o alvo; wiki, ficha e dados utilizáveis no celular |
| Backup | Comando `pnpm backup` gera dump do banco + assets; exportação Markdown da wiki (W12) |
| Licença | AGPL-3.0, para que forks hospedados continuem abertos (alternativa: MIT, se quiser zero atrito) |
| Qualidade | Testes unitários no núcleo (permissões, parser de dados, fórmulas, visibilidade); E2E com Playwright nos fluxos críticos; CI no GitHub Actions |

## 9. Decisões e perguntas em aberto

**Decisões registradas**

| # | Decisão | Por quê |
| --- | --- | --- |
| ADR-1 | Turborepo: `apps/web` (Next.js puro) + `apps/realtime` (Socket.IO + Hocuspocus) + `packages/core`, num docker compose | Route handlers do Next respondem uma requisição e encerram; não aceitam conexão WebSocket persistente, nem com next start. Separar o tempo real mantém o Next padrão (output standalone, sem perder otimizações) e continua sendo um repo, um build e um compose. Sem NestJS |
| ADR-2 | Self-host, não Vercel | Vercel não mantém conexões WebSocket; o alvo é VPS própria |
| ADR-3 | Wiki colaborativa com Yjs + Hocuspocus; tabuleiro, fichas e chat com Socket.IO autoritativo | Texto precisa de CRDT para não perder edição; o resto precisa de filtro por permissão, que é natural com servidor autoritativo e salas por papel |
| ADR-4 | Blocos secretos em documentos Yjs separados | Um documento Yjs é enviado inteiro; segredo dentro dele vazaria |
| ADR-5 | Postgres + Drizzle ORM | Tipagem forte, migrações simples, roda em qualquer lugar |
| ADR-6 | Better Auth (email/senha + Discord) | Self-hosted, sem serviço externo, integra com Drizzle |
| ADR-7 | TipTap para o editor, Excalidraw (MIT) para o quadro, PixiJS para o tabuleiro, pdf.js para exibir PDF, pdf-lib para exportar | Bibliotecas maduras, MIT/Apache, muito código de exemplo para a IA usar |
| ADR-8 | Dado 3D com biblioteca do projeto 3d-dice, resultado vindo do servidor | Física bonita pronta; só precisa animar até um resultado pré-definido |
| ADR-9 | UI com Tailwind + shadcn/ui, tema escuro como padrão | Bonito rápido, e você já domina essa stack. O app é só tema escuro no v1: um tema bem polido vale mais que dois medianos |

**Perguntas em aberto**

- [ ] Nome final do projeto (Grimório é provisório; checar se o nome está livre no GitHub e npm).
- [ ] AGPL-3.0 ou MIT?
- [ ] Grid hexagonal entra no v1 ou fica para depois?
- [ ] Importar dados do Roll20 ou do LegendKeeper vale o esforço?
