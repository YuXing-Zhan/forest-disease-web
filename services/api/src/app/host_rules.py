from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HostCandidateRefinement:
    display_name: str
    supporting_evidence: str
    source_url: str


_CERCIS_CHINENSIS_ALIASES = {
    "紫荆",
    "cercischinensis",
    "chineseredbud",
}

_PSEUDOCERCOSPORA_ALIASES = (
    "假尾孢菌",
    "假尾孢菌屬",
    "假尾孢菌属",
    "pseudocercospora",
)


def _normalize(value: str) -> str:
    return "".join(value.casefold().split())


def refine_host_candidate(
    species_input: str | None,
    candidate_name: str,
) -> HostCandidateRefinement | None:
    """将供应商的属级候选与保守的宿主专一文献规则交叉核对。"""
    if not species_input:
        return None

    host = _normalize(species_input)
    candidate = _normalize(candidate_name)
    if host not in _CERCIS_CHINENSIS_ALIASES:
        return None
    if not any(alias in candidate for alias in _PSEUDOCERCOSPORA_ALIASES):
        return None

    return HostCandidateRefinement(
        display_name="紫荆假尾孢叶斑病（高度疑似）",
        supporting_evidence=(
            "宿主为紫荆（Cercis chinensis），已有同行评议文献报道"
            "Pseudocercospora cercidicola 可引起相符的紫荆叶斑症状"
        ),
        source_url="https://doi.org/10.1094/PDIS-04-19-0813-PDN",
    )
