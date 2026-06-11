from __future__ import annotations

from app.real_quote import parse_sidebar_quote, real_quote_check_from_result, real_quote_ev


def test_parse_total_odds_from_sidebar_text():
    quote = parse_sidebar_quote("Same Game Parlay  Total Odds 14.50  Est. Payout $145.00")
    assert quote["quotedOdds"] == 14.5


def test_parse_multiplier_x_form():
    assert parse_sidebar_quote("SGM 8.2x  4 selections")["quotedOdds"] == 8.2


def test_parse_returns_none_without_quote():
    assert parse_sidebar_quote("nothing here")["quotedOdds"] is None


def test_real_quote_flips_positive_product_ev_to_negative_at_real_quote():
    legs = [
        {"winProbability": 0.6, "odds": 2.0},
        {"winProbability": 0.5, "odds": 2.2},
        {"winProbability": 0.45, "odds": 1.8},
    ]
    # Product odds ~7.92 (positive EV); Stake reprices the SGM to 6.0.
    check = real_quote_ev(legs, 6.0)
    assert check["productExpectedValue"] > 0
    assert check["realExpectedValue"] < 0
    assert check["correlationRepricingGap"] < 0
    assert check["verdict"] == "negative_ev_at_real_quote"


def test_real_quote_check_from_result_parses_and_scores():
    result = {
        "selectedRows": [
            {"player": "A", "market": "hits", "side": "over", "odds": 1.9,
             "probabilityAssessment": {"estimatedProbability": 0.6}},
            {"player": "B", "market": "strikeouts", "side": "over", "odds": 2.1,
             "probabilityAssessment": {"estimatedProbability": 0.55}},
        ],
        "addBetResult": {"postClick": {"rightPanelText": "Bet Slip Total Odds 3.60 Est Payout"}},
    }
    check = real_quote_check_from_result(result)
    assert check["status"] == "evaluated"
    assert check["quotedOdds"] == 3.6
    assert check["realExpectedValue"] is not None
