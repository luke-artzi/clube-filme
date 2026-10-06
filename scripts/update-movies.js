'use strict';

// Atualiza data/movies.json com o Top 250 atual do IMDb (títulos em português).
// Uso: npm run update-movies   (precisa de acesso à internet)

const fs = require('node:fs');
const path = require('node:path');

const URL = 'https://www.imdb.com/pt/chart/top/';
const OUT = path.join(__dirname, '..', 'data', 'movies.json');

async function main() {
  const res = await fetch(URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`IMDb respondeu ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match) throw new Error('Não encontrei os dados da lista na página do IMDb.');

  const edges = JSON.parse(match[1])?.props?.pageProps?.pageData?.chartTitles?.edges;
  if (!Array.isArray(edges) || edges.length === 0) throw new Error('Formato da página do IMDb mudou.');

  const movies = edges.map((edge, i) => {
    const node = edge.node;
    return {
      rank: edge.currentRank ?? i + 1,
      id: node.id,
      title: node.titleText?.text,
      originalTitle: node.originalTitleText?.text ?? node.titleText?.text,
      year: node.releaseYear?.year,
    };
  });

  // Não salva uma lista quebrada (página bloqueada, formato novo etc.).
  const invalid = movies.filter((m) => !/^tt\d+$/.test(m.id || '') || !m.title || !Number.isInteger(m.year));
  if (movies.length < 240 || invalid.length) {
    throw new Error(`Lista suspeita: ${movies.length} filmes, ${invalid.length} inválidos. Nada foi salvo.`);
  }

  fs.writeFileSync(OUT, JSON.stringify({ source: URL, updatedAt: new Date().toISOString().slice(0, 10), movies }, null, 1) + '\n');
  console.log(`Salvo ${movies.length} filmes em ${path.relative(process.cwd(), OUT)}. Reinicie o servidor para aplicar.`);
}

main().catch((err) => {
  console.error('Falha ao atualizar:', err.message);
  process.exit(1);
});
