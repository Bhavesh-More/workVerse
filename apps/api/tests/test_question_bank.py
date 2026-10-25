from app.company import question_bank as qb


def test_bank_only_for_marked_assessments():
    assert qb.for_assessment("qb-123e4567") is not None
    assert qb.for_assessment("123e4567") is None
    assert qb.for_assessment(None) is None


def test_colleague_asks_next_question_every_other_reply():
    bank = qb.for_assessment("qb-x")
    manager = [q["question"] for q in bank if q["ask_by"] == "manager"]
    assert manager[0] in qb.prompt_line(bank, "manager", 0)
    assert qb.prompt_line(bank, "manager", 1) == ""
    assert manager[1] in qb.prompt_line(bank, "manager", 2)
    assert qb.prompt_line(bank, "manager", 99 * 2) == ""  # bank exhausted
    assert qb.prompt_line(bank, "unknown_slot", 0) == ""
    assert qb.prompt_line(None, "manager", 0) == ""
