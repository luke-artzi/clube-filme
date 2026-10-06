# 🎬 Clube do Filme

Site do grupo **Clube do Filme** com os filmes do [Top 250 do IMDb](https://www.imdb.com/pt/chart/top/).
Cada membro cria sua conta, marca os filmes que já assistiu e dá uma nota de **1 a 10**.

## Funcionalidades

- **Login e cadastro** com usuário e senha. As senhas são guardadas com scrypt e a sessão fica num cookie httpOnly.
- **Código de convite** (opcional) para que só o pessoal do clube consiga criar conta.
- **Lista dos 250 filmes** com título em português, título original, ano e link para o IMDb.
- Clicar numa nota de 1 a 10 marca o filme como **assistido** com essa nota. "Desmarcar" remove a nota.
- Busca por título ou ano, filtros (assistidos e não assistidos) e ordenação (posição no IMDb, minha nota, média do clube, ano, título).
- **Média do clube** em cada filme. Ao clicar no título, aparecem as notas de cada membro.
- **Ranking do clube**: os filmes ordenados pela média das notas dos membros.
- **Abrir no Stremio**: cada filme tem um link que abre a página dele no app do Stremio, ou no Stremio Web. O que aparece para assistir depende dos addons que cada pessoa instalou no próprio Stremio.
- **Membros**: quanto cada pessoa já assistiu, a média dela e a lista das notas que deu.

## Como rodar

Precisa do **Node.js 22.13 ou mais novo**. O banco é o SQLite embutido no Node, então não há nada para instalar além do Express.

```bash
npm install
CLUB_INVITE_CODE=pipoca npm start
# abra http://localhost:3000
```

### Variáveis de ambiente

| Variável           | Padrão          | Descrição |
|--------------------|-----------------|-----------|
| `PORT`             | `3000`          | Porta do servidor |
| `DB_PATH`          | `data/clube.db` | Arquivo do banco SQLite |
| `CLUB_INVITE_CODE` | *(vazio)*       | Se definido, esse código é exigido para criar conta |
| `NODE_ENV`         | —               | Use `production` em HTTPS (o cookie passa a ser `Secure`) |

## Atualizar a lista do IMDb

A lista fica em `data/movies.json`. Para baixar o Top 250 atual direto do IMDb:

```bash
npm run update-movies
```

Depois reinicie o servidor. Filmes que saíram do Top 250 somem da lista, mas as notas antigas continuam guardadas no banco.

## Deploy

Funciona em qualquer serviço que rode Node e tenha **disco persistente** para o arquivo SQLite, como Render (com Disk), Railway (com Volume), Fly.io ou uma VPS.
Configure `DB_PATH` apontando para o disco persistente, defina `CLUB_INVITE_CODE` e `NODE_ENV=production`, e use `npm start` como comando.

## Testes

```bash
npm test
```
