import json
import re
from pathlib import Path


def replace_terms(text, mappings):
    if not mappings:
        return text
    lookup = {key.casefold(): value for key, value in mappings.items()}
    # Match once against the original words, including meaningful technical symbols.
    names = '|'.join(re.escape(key) for key in sorted(lookup, key=len, reverse=True))
    pattern = r'(?<![\w+#])(?:' + names + r')(?![\w+#])'
    return re.sub(pattern, lambda m: lookup.get(m[0].casefold(), m[0]), text, flags=re.I)


class CaptionTerms:
    """The original English remains available when a correction is undone."""
    def __init__(self, directory: Path):
        self.path = directory / 'caption-terms.json'
        self.saved = json.loads(self.path.read_text(encoding='utf-8')) if self.path.exists() else {}
        self.begin(None)

    def begin(self, session):
        self.session = session
        self.lines = {}
        self.rules = {}
        self.by_line = {}
        self.undo = []

    def caption(self, caption):
        original = caption.get('recognizedText', caption['text'])
        rules = {**self.saved, **self.rules, **self.by_line.get(caption['id'], {})}
        text = replace_terms(original, rules)
        result = {**caption, 'text': text}
        if text != original:
            result['recognizedText'] = original
        self.lines[caption['id']] = {k: v for k, v in result.items() if k != 'preview'}
        return result

    def change(self, identifier, scope, alias, replacement):
        if identifier not in self.lines:
            raise ValueError('当前会话中没有这条字幕。')
        if scope == 'undo':
            if not self.undo:
                raise ValueError('没有可撤销的纠词。')
            target, key, old = self.undo[-1]
            change = old
        else:
            key = alias.strip().casefold()
            change = replacement.strip()
            if not key or not change or replace_terms(self.lines[identifier].get('recognizedText', self.lines[identifier]['text']), {key: ''}) == self.lines[identifier].get('recognizedText', self.lines[identifier]['text']):
                raise ValueError('请输入原话中完整的词或短语。')
            target = self.saved if scope == 'remember' else self.rules if scope == 'session' else self.by_line.setdefault(identifier, {})
        revised = dict(target)
        if change is None:
            revised.pop(key, None)
        else:
            revised[key] = change
        if target is self.saved:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(revised, ensure_ascii=False, indent=2), encoding='utf-8')
            tmp.replace(self.path)
        if scope == 'undo':
            self.undo.pop()
        else:
            self.undo.append((target, key, target.get(key)))
        target.clear()
        target.update(revised)
        changed = []
        for old in list(self.lines.values()):
            new = self.caption(old)
            if old['text'] == new['text']:
                continue
            new['revision'] += 1
            self.lines[new['id']]['revision'] = new['revision']
            changed.append(new)
        return changed
