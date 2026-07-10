# 🎤 Cante Alto

Jogo de festa pra jogar em roda. A palavra aparece na TV/PC (host), todo mundo
está com o celular na mão, e **quem clicar primeiro na palavra tem que cantar
uma música com ela**. Depois a roda vota se a pessoa mandou bem.

## Como funciona

1. O host abre `/host` e escolhe **Local** (mesmo Wi‑Fi) ou **Web** (internet).
   Uma sala é criada com um **código de 4 letras**.
2. A palavra aparece na tela principal (host) com um cronômetro.
3. No celular, a mesma palavra vira um botão gigante. O **primeiro a apertar** ganha.
4. Na tela do host: nome do vencedor → contagem **3, 2, 1** → **CANTE ALTO!**
5. Cronômetro pra pessoa cantar.
6. Todo mundo (menos quem cantou) vota 👍 / 👎. Quem manda bem ganha 1 ponto.

Vários grupos podem jogar ao mesmo tempo — cada sala é isolada pelo código.

## Rodar

Precisa do [Node.js](https://nodejs.org) instalado.

```bash
npm install
npm start
```

Abra a tela principal em `http://localhost:3000/host` e escolha o modo:

### Modo Local (mesmo Wi‑Fi)
Os jogadores entram por `http://SEU_IP:3000/?room=CODIGO` — o host mostra o link
e o QR code prontos. Só apontar a câmera.

### Modo Web (pela internet)
Os jogadores entram pelo **mesmo endereço público que o host usou** para abrir a
página. Para isso o servidor precisa estar acessível pela internet, de uma das formas:

- **Publicado** num host (Render, Railway, Fly.io, Azure...). Aí o host abre
  `https://seu-app.onrender.com/host`.
- **Exposto por um túnel** a partir da sua máquina, por exemplo:
  ```bash
  npm start                 # roda local na porta 3000
  npx localtunnel --port 3000    # ou: ngrok http 3000
  ```
  Abra a URL pública que o túnel gerar + `/host`. O QR mostrado aos jogadores já
  usa essa URL pública automaticamente.

## Publicar na internet (modo Web)

### Render (recomendado — roda o app inteiro)
O jogo é um **servidor Socket.IO** (conexão em tempo real que fica aberta). O Render
roda isso direto:

1. Suba este projeto para um repositório no GitHub.
2. No Render: **New → Blueprint** e aponte pro repo (ele lê o `render.yaml`).
   - Ou **New → Web Service** manual: Build `npm install`, Start `npm start`.
3. Pronto. O host abre `https://seu-app.onrender.com/host` e escolhe **Web**;
   os jogadores entram pela mesma URL (o QR já usa o domínio público).

> Plano free do Render "hiberna" após ~15 min sem uso — a primeira conexão depois
> disso demora alguns segundos pra acordar. Alternativas equivalentes: Railway, Fly.io.

### Netlify — não serve para este app
O Netlify hospeda **sites estáticos + funções serverless de curta duração**. Ele
**não mantém um servidor Socket.IO aberto**, que é o coração do jogo (detectar quem
clicou primeiro, votos ao vivo). Então o app não roda no Netlify como está.
Use o Render (ou Railway/Fly) para o modo Web.

## Stack

- Node.js + Express
- Socket.IO (tempo real — o servidor decide quem clicou primeiro)
- QR code gerado no servidor
- Front puro em HTML/CSS/JS, sem build

## Palavras

Lista embutida em `server.js` (constante `WORDS`). É só editar o array pra
adicionar/trocar palavras.
