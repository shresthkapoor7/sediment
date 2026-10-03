from typing import Literal

Domain = Literal['ai', 'biomed', 'math_physics', 'general']
# OpenAlex field IDs: https://help.openalex.org/data/fields/
DOMAIN_FIELDS = {
    'ai': ('17',),  # Computer science
    'biomed': ('11', '13', '24', '27', '28', '30'),
    'math_physics': ('26', '31'),
    'general': (),
}
DOMAIN_SOURCES = {
    'ai': ('arxiv', 'huggingface', 'journals', 'openalex'),
    'biomed': ('biorxiv', 'medrxiv', 'journals', 'openalex'),
    'math_physics': ('arxiv', 'journals', 'openalex'),
    'general': ('repositories', 'journals', 'openalex'),
}
