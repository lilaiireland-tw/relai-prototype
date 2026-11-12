"""Offline reproducibility check for Issue #112. Never connects to D1 or writes data."""
import argparse
import json
import random
import re
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--snapshot', type=Path, required=True)
args = parser.parse_args()
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
try:
    db.executescript(args.snapshot.read_text(encoding='utf-8-sig'))
    rows = [dict(row) for row in db.execute('SELECT * FROM vocabulary_catalog')]
finally:
    db.close()
legacy_b1 = json.loads(Path('data/ai-enrichment/b1-sample-20.json').read_text(encoding='utf-8'))
approved = Path('src/worker/persistence/starter-pack.ts').read_text(encoding='utf-8')
# Curated B1 revision: six legacy cards retained, eight completed existing entries,
# and six new completions. The selection is fixed and its order is seeded.
b1_selection = [
    ('abandon', 'verb'),
    ('absorb', 'verb'),
    ('academic', 'adjective'),
    ('accent', 'noun'),
    ('access', 'noun'),
    ('accessible', 'adjective'),
    ('document', 'noun'),
    ('former', 'adjective'),
    ('immediately', 'adverb'),
    ('interview', 'verb'),
    ('locate', 'verb'),
    ('practical', 'adjective'),
    ('protest', 'noun'),
    ('reduce', 'verb'),
    ('respect', 'verb'),
    ('service', 'noun'),
    ('shout', 'verb'),
    ('teamwork', 'noun'),
    ('visa', 'noun'),
    ('widespread', 'adjective'),
]
b1 = []
for word, pos in sorted(b1_selection):
    matched = [row for row in rows if row['headword'] == word
               and row['part_of_speech'] == pos and row['cefr_level'] == 'B1'
               and row['source_dataset'] == 'CEFR-J Vocabulary Profile'
               and row['source_version'] == '1.6'
               and row['publication_status'] == 'published' and not row['owner_user_id']]
    assert len(matched) == 1, 'B1 Catalog candidate missing or ambiguous: ' + word
    b1.append(matched[0])
random.Random('relai-112-2026-11-12:B1-revised').shuffle(b1)
assert [row['id'] for row in b1] == re.findall(
    r"'(cefr-j-[a-f0-9]+)'", approved.split('B1: [')[1].split(']')[0])
legacy_ids = {row['id'] for row in legacy_b1}
assert len(legacy_ids.intersection(row['id'] for row in b1)) == 6
assert 'aborigine' not in [row['headword'] for row in b1]
b1_bins = {'A-F': 0, 'G-L': 0, 'M-R': 0, 'S-Z': 0}
for row in b1:
    letter = row['headword'][0].lower()
    b1_bins['A-F' if letter <= 'f' else 'G-L' if letter <= 'l' else 'M-R' if letter <= 'r' else 'S-Z'] += 1
assert b1_bins == {'A-F': 8, 'G-L': 3, 'M-R': 4, 'S-Z': 5}
print(json.dumps({'level': 'B1', 'seed': 'relai-112-2026-11-12:B1-revised',
                  'distribution': b1_bins, 'retained_legacy': 6,
                  'ids': [row['id'] for row in b1],
                  'headwords': [row['headword'] for row in b1]}))
# Keep A1/A2/B2 source selection stable relative to the original approved snapshot.
used = {row['headword'] for row in legacy_b1}
rejected = {
    'A1': {'short', 'wake', 'judge'},
    'A2': {'yeah', 'spaceship'},
    'B2': {'mystify', 'Soviet', 'slaughter', 'funk', 'ballad'},
}
for level in ['A1', 'A2', 'B2']:
    pool = sorted([row for row in rows if row['cefr_level'] == level
                   and row['source_dataset'] == 'CEFR-J Vocabulary Profile'
                   and row['source_version'] == '1.6'
                   and row['publication_status'] == 'published' and not row['owner_user_id']
                   and row['part_of_speech'] in ['noun', 'verb', 'adjective', 'adverb']
                   and row['headword'].isalpha() and len(row['headword']) > 2
                   and row['headword'] not in used], key=lambda row: row['id'])
    seed = 'relai-112-2026-11-12:' + level
    random.Random(seed).shuffle(pool)
    selected = []
    skipped = []
    for row in pool:
        if row['headword'] in rejected[level]:
            skipped.append(row['headword'])
            continue
        selected.append(row)
        if len(selected) == 20:
            break
    used.update(row['headword'] for row in selected)
    ids = [row['id'] for row in selected]
    expected = re.findall(r"'(cefr-j-[a-f0-9]+)'", approved.split(level + ': [')[1].split(']')[0])
    assert ids == expected, 'Selection differs from approved fixed IDs: ' + level
    bins = {key: 0 for key in ['A-F', 'G-L', 'M-R', 'S-Z']}
    for row in selected:
        letter = row['headword'][0].lower()
        bins['A-F' if letter <= 'f' else 'G-L' if letter <= 'l' else 'M-R' if letter <= 'r' else 'S-Z'] += 1
    assert len(ids) == len(set(ids)) == 20 and all(bins.values())
    print(json.dumps({'level': level, 'seed': seed, 'distribution': bins, 'replacements': skipped,
                      'ids': ids, 'headwords': [row['headword'] for row in selected]}))
