const ATTRIBUTES = /([\w-]+)="([^"]*)"/g;

export function safeHttpUrl(value, baseUrl) {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function parsePlaylist(source, baseUrl) {
  const channels = [];
  let pending = null;
  let groupOverride = '';

  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const attributes = Object.fromEntries([...line.matchAll(ATTRIBUTES)].map((match) => [match[1].toLowerCase(), match[2]]));
      const comma = line.lastIndexOf(',');
      const title = comma >= 0 ? line.slice(comma + 1).trim() : '';
      pending = {
        name: title || attributes['tvg-name'] || 'Canal sin nombre',
        group: attributes['group-title'] || 'General',
        logo: safeHttpUrl(attributes['tvg-logo'] || '') || '',
      };
      groupOverride = '';
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      groupOverride = line.slice(8).trim();
      continue;
    }

    if (line.startsWith('#')) continue;
    const url = safeHttpUrl(line, baseUrl);
    if (pending && url) {
      channels.push({
        id: channels.length + 1,
        name: pending.name,
        group: groupOverride || pending.group,
        logo: pending.logo,
        url,
      });
    }
    pending = null;
    groupOverride = '';
  }

  return channels;
}

export function groupsFor(channels) {
  return [...new Set(channels.map((channel) => channel.group))].sort((a, b) => a.localeCompare(b, 'es'));
}
