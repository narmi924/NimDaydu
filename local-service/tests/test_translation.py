from nimdaydu.translation import SPACES_IN_CHINESE, LlamaTranslator, normalize_terms
import re


def test_opus_word_spaces_are_removed_only_around_chinese():
    assert SPACES_IN_CHINESE.sub('', '这和 呃 使用 案件 下降 是一样的。') == '这和呃使用案件下降是一样的。'
    assert SPACES_IN_CHINESE.sub('', '我们用 GitHub Actions 部署') == '我们用GitHub Actions部署'


class Response:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass

    def json(self):
        return {'choices': [{'message': {'content': self.text}}]}


class Client:
    def __init__(self):
        self.requests = []

    def post(self, url, json):
        self.requests.append(json)
        return Response('  我们先检查代码。 ')


class Process:
    def poll(self):
        return None


def test_hy_mt_prompt_normalizes_terms_and_returns_trimmed_chinese():
    translator = LlamaTranslator.__new__(LlamaTranslator)
    translator.client, translator.process, translator.port = Client(), Process(), 1
    translator.terms = [(re.compile(r'(?<!\w)discord(?!\w)', re.IGNORECASE), 'Discord')]
    assert translator.translate('let us check discord first.', ['Earlier line.']) == '我们先检查代码。'
    request = translator.client.requests[0]
    assert request['messages'] == [{'role': 'user', 'content': translator.PROMPT.format(text='let us check Discord first.')}]
    assert request['temperature'] == 0
    assert normalize_terms(translator.terms, 'DISCORD') == 'Discord'
