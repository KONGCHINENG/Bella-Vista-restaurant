const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const items = [
  // Starters
  { category: 'starter', name: 'Burrata e prosciutto', description: 'Puglian burrata, 18-month prosciutto, charred bread.', price: 19, photo: 'burrata-e-prosciutto.jpg' },
  { category: 'starter', name: 'Carpaccio di manzo', description: 'Thin-sliced raw beef, wild arugula, shaved parmesan, lemon.', price: 18, photo: 'carpaccio-di-manzo.jpg' },
  { category: 'starter', name: 'Polpo alla griglia', description: 'Grilled octopus, white bean purée, salsa verde.', price: 21, photo: 'polpo-alla-griglia.jpg' },
  { category: 'starter', name: 'Arancini al tartufo', description: 'Truffle and mozzarella rice croquettes, saffron aioli.', price: 14, photo: 'arancini-al-tartufo.jpg' },
  { category: 'starter', name: 'Insalata di campo', description: 'Market greens, roasted beets, walnuts, gorgonzola.', price: 12, photo: 'insalata-di-campo.jpg' },
  // Mains
  { category: 'main', name: 'Tagliatelle al ragù', description: 'Slow-braised beef and pork, six-hour sauce, fresh egg pasta.', price: 24, photo: 'tagliatelle-al-ragu.jpg' },
  { category: 'main', name: 'Branzino al forno', description: 'Whole roasted sea bass, lemon, capers, Taggiasca olives.', price: 32, photo: 'branzino-al-forno.jpg' },
  { category: 'main', name: 'Risotto ai funghi', description: 'Porcini and wild mushroom risotto, parmesan, thyme.', price: 26, photo: 'risotto-ai-funghi.jpg' },
  { category: 'main', name: 'Osso buco', description: 'Braised veal shank, saffron risotto, gremolata.', price: 34, photo: 'osso-buco.jpg' },
  { category: 'main', name: 'Ravioli di zucca', description: 'House-made pumpkin ravioli, sage butter, toasted hazelnuts.', price: 23, photo: 'ravioli-di-zucca.jpg' },
  { category: 'main', name: 'Bistecca alla fiorentina (for two)', description: 'Grilled T-bone, rosemary potatoes, salsa verde.', price: 68, photo: 'bistecca-alla-fiorentina.jpg' },
  // Desserts
  { category: 'dessert', name: 'Tiramisù della casa', description: 'Made fresh daily — no exceptions, no shortcuts.', price: 12, photo: 'tiramisu-della-casa.jpg' },
  { category: 'dessert', name: 'Panna cotta al limone', description: 'Lemon panna cotta, blackberry compote.', price: 10, photo: 'panna-cotta-al-limone.jpg' },
  { category: 'dessert', name: 'Torta di cioccolato', description: 'Warm flourless chocolate cake, vanilla gelato.', price: 13, photo: 'torta-di-cioccolato.jpg' },
  { category: 'dessert', name: 'Cannoli siciliani', description: 'Ricotta-filled shells, pistachio, candied orange.', price: 11, photo: 'cannoli-siciliani.jpg' }
];

async function main(){
  const existing = await prisma.menuItem.count();
  if (existing > 0){
    console.log(`MenuItem table already has ${existing} rows — skipping seed to avoid duplicates.`);
    return;
  }
  await prisma.menuItem.createMany({ data: items });
  console.log(`Seeded ${items.length} menu items.`);
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); process.exit(1); });
