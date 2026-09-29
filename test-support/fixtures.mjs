// Builders for the dataset shapes the tests share. Each call returns a fresh
// object, because tests mutate what they build; pass overrides for anything a
// test depends on rather than relying on a default staying put.

export const category = (over = {}) => ({
  id: 'books', label: 'Books', inGameDescriptor: null, aliases: [], ...over,
});

export const gift = (over = {}) => ({
  id: 'g1', name: 'G', category: 'books', rarity: 'common', description: '', sources: [], ...over,
});

export const character = (over = {}) => ({
  id: 'c1', name: 'C', giftable: true, spoiler: false,
  traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null, ...over,
});

export const observation = (over = {}) => ({
  id: 'o1', gift: 'g1', character: 'c1', reaction: 'liked', date: '2026-09-20', ...over,
});

// The guide source most fixtures cite.
export const source = (over = {}) => ({
  id: 'polygon-1', title: '', author: null, publisher: 'Polygon', url: '', retrieved: '2026-09-20', ...over,
});

export const dataset = (over = {}) => ({
  categories: [], gifts: [], characters: [], observations: [], sources: [], ...over,
});
