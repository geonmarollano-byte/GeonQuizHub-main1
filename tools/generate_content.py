#!/usr/bin/env python3
"""
GEON'S GAMEHUB - question bank generator.

Builds questions.json (Previous questioner) and questions.new.json (New
questioner), plus their embedded JS fallbacks, following the blueprint
distributions EXACTLY:

  Each questioner = 5 subjects x 2 quiz types ("SUBJECT 1", "SUBJECT 2")
  Each quiz path = 80 questions (levels 1..80)  ->  800 records per questioner

Usage: python3 tools/generate_content.py
"""
import json
import random
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pools
import pools_extra

# ---------------------------------------------------------------------------
# Blueprint catalog: topic order and counts per quiz path (80 each)
# ---------------------------------------------------------------------------
CATALOG = {
    "MATH": [
        ("Multiplication", 15),
        ("Division", 15),
        ("Addition", 15),
        ("Subtraction", 15),
        ("Problem Solving", 20),
    ],
    "SCIENCE": [
        ("Solid, Liquid, Gas", 15),
        ("Translational / Rotational Motions", 15),
        ("Pascal's Principles", 20),
        ("Archimedes' Principles", 15),
        ("History", 15),
    ],
    "PSYCHOLOGY": [
        ("Mind Manipulations", 20),
        ("Self Resilience", 20),
        ("Convince Others", 20),
        ("How to Become Unstoppable", 20),
    ],
    "TECH 1": [
        ("System Unit and Its Components", 30),
        ("OHS Guidelines and DMA Procedures", 20),
        ("Assemble and Disassemble System Unit", 30),
    ],
    "TECH 2": [
        ("BIOS / CMOS / UEFI", 30),
        ("Networking", 20),
        ("Windows Installation", 20),
        ("Safety Procedures", 10),
    ],
}

SUBJECT_SLUG = {"MATH": "math", "SCIENCE": "sci", "PSYCHOLOGY": "psy", "TECH 1": "t1", "TECH 2": "t2"}
QUIZ_SLUG = {"SUBJECT 1": "s1", "SUBJECT 2": "s2"}

NEW_LEAD_INS = ["Quick check: ", "In class: ", "Think fast: ", "Recall this: "]
PREV_LEAD_INS = ["", "", "", "Recall: "]


# ---------------------------------------------------------------------------
# MATH procedural generators (fully distinct content per questioner)
# ---------------------------------------------------------------------------
def gen_multiplication(rng, count):
    out = []
    seen = set()
    names = ["Ana", "Bea", "Carlo", "Dino", "Elsa", "Franz", "Gil", "Hana", "Ivan", "Joy",
             "Kris", "Liza", "Miguel", "Nena", "Omar", "Pia", "Quin", "Rhea", "Sam", "Tina"]
    items = ["pencils", "chairs", "books", "mangoes", "eggs", "stickers", "bottles", "cookies",
             "notebooks", "balls", "shells", "candies"]
    while len(out) < count:
        a = rng.randint(2, 12)
        b = rng.randint(2, 12)
        ans = a * b
        style = rng.randint(0, 2)
        if style == 0:
            q = f"What is {a} x {b}?"
        elif style == 1:
            n, item = rng.choice(names), rng.choice(items)
            q = f"{n} arranges {a} rows of {item} with {b} in each row. How many {item} are there in all?"
        else:
            n, item = rng.choice(names), rng.choice(items)
            q = f"Each pack holds {b} {item}. If {n} buys {a} packs, how many {item} does {n} have?"
        if q in seen:
            continue
        seen.add(q)
        distr = sorted({ans + a, ans - b, ans + rng.choice([-2, -1, 1, 2]), ans + b})
        while len(distr) < 3:
            distr.append(ans + rng.choice([3, 4, 5]))
        out.append((q, str(ans), [str(x) for x in distr[:3]],
                    f"{a} x {b} = {ans}.", f"Use repeated addition or the multiplication table for {a} and {b}."))
    return out


def gen_division(rng, count):
    out = []
    seen = set()
    names = ["Ana", "Bea", "Carlo", "Dino", "Elsa", "Franz", "Gil", "Hana", "Ivan", "Joy",
             "Kris", "Liza", "Miguel", "Nena", "Omar", "Pia", "Quin", "Rhea", "Sam", "Tina"]
    items = ["pencils", "chairs", "cards", "mangoes", "eggs", "stickers", "bottles", "cookies",
             "notebooks", "balls", "shells", "candies"]
    while len(out) < count:
        d = rng.randint(2, 12)
        q_ = rng.randint(2, 12)
        total = d * q_
        style = rng.randint(0, 2)
        if style == 0:
            q = f"What is {total} / {d}?"
        elif style == 1:
            n, item = rng.choice(names), rng.choice(items)
            q = f"{n} shares {total} {item} equally among {d} friends. How many {item} does each friend get?"
        else:
            item = rng.choice(items)
            q = f"{total} {item} are packed with {d} in each box. How many boxes are needed?"
        if q in seen:
            continue
        seen.add(q)
        distr = sorted({q_ + 1, q_ - 1, q_ + d, q_ + rng.choice([2, 3])})
        distr = [x for x in distr if x != q_ and x > 0][:3]
        while len(distr) < 3:
            distr.append(q_ + len(distr) + 2)
        out.append((q, str(q_), [str(x) for x in distr],
                    f"{total} / {d} = {q_} because {d} x {q_} = {total}.",
                    f"Ask: {d} times what number equals {total}?"))
    return out


def gen_addition(rng, count):
    out = []
    seen = set()
    names = ["Ana", "Bea", "Carlo", "Dino", "Elsa", "Franz", "Gil", "Hana"]
    while len(out) < count:
        style = rng.randint(0, 2)
        if style == 0:
            a, b = rng.randint(10, 99), rng.randint(10, 99)
            q = f"What is {a} + {b}?"
            exp = f"{a} + {b} = {a + b}."
            hint = "Add the ones first, then the tens (regroup if needed)."
        elif style == 1:
            a, b = rng.randint(100, 899), rng.randint(100, 899)
            q = f"What is {a} + {b}?"
            exp = f"{a} + {b} = {a + b}."
            hint = "Line up the digits by place value."
        else:
            a, b = rng.randint(25, 250), rng.randint(25, 250)
            n1, n2 = rng.choice(names), rng.choice(names)
            q = f"{n1} collected {a} shells and {n2} collected {b} shells. How many shells did they collect together?"
            exp = f"Together: {a} + {b} = {a + b} shells."
            hint = "'Together' means addition."
        ans = a + b
        if q in seen:
            continue
        seen.add(q)
        distr = sorted({ans + 10, ans - 10, ans + rng.choice([-1, 1]), ans + 100})
        distr = [x for x in distr if x != ans][:3]
        out.append((q, str(ans), [str(x) for x in distr], exp, hint))
    return out


def gen_subtraction(rng, count):
    out = []
    seen = set()
    names = ["Ana", "Bea", "Carlo", "Dino", "Elsa", "Franz", "Gil", "Hana"]
    items = ["stickers", "pages", "cookies", "marbles", "coins", "cards", "crayons", "seeds"]
    while len(out) < count:
        style = rng.randint(0, 2)
        if style == 0:
            a, b = rng.randint(30, 99), rng.randint(11, 29)
            q = f"What is {a} - {b}?"
            exp = f"{a} - {b} = {a - b}."
            hint = "Subtract the ones (borrow if needed), then the tens."
        elif style == 1:
            a, b = rng.randint(300, 950), rng.randint(120, 280)
            q = f"What is {a} - {b}?"
            exp = f"{a} - {b} = {a - b}."
            hint = "Line up the digits by place value and borrow as needed."
        else:
            a = rng.randint(60, 300)
            b = rng.randint(15, a - 10)
            n, item = rng.choice(names), rng.choice(items)
            q = f"{n} had {a} {item} and gave away {b}. How many {item} are left?"
            exp = f"Left: {a} - {b} = {a - b} {item}."
            hint = "'Gave away' and 'left' mean subtraction."
        ans = a - b
        if q in seen:
            continue
        seen.add(q)
        distr = sorted({ans + 10, ans - 10, ans + rng.choice([-1, 1]), ans + 9})
        distr = [x for x in distr if x != ans][:3]
        out.append((q, str(ans), [str(x) for x in distr], exp, hint))
    return out


def gen_problem_solving(rng, count):
    out = []
    seen = set()
    names = ["Ana", "Bea", "Carlo", "Dino", "Elsa", "Franz", "Gil", "Hana", "Ivan", "Joy"]
    stores = ["store", "canteen", "bookshop", "market"]
    while len(out) < count:
        kind = rng.randint(0, 7)
        if kind == 0:  # change
            price = rng.randint(12, 89)
            paid = price + rng.randint(11, 90)
            n, st = rng.choice(names), rng.choice(stores)
            q = f"{n} bought a notebook for {price} pesos at the {st} and paid {paid} pesos. How much change did {n} receive?"
            ans = paid - price
            exp = f"Change = {paid} - {price} = {ans} pesos."
            hint = "Change = money paid - price."
        elif kind == 1:  # two-step
            a = rng.randint(10, 40)
            b = rng.randint(10, 40)
            c = rng.randint(5, 25)
            n = rng.choice(names)
            q = f"{n} had {a} cards, won {b} more, then gave {c} to a friend. How many cards does {n} have now?"
            ans = a + b - c
            exp = f"{a} + {b} = {a + b}; {a + b} - {c} = {ans} cards."
            hint = "Solve in two steps: first add, then subtract."
        elif kind == 2:  # total cost
            price = rng.randint(6, 25)
            qty = rng.randint(3, 9)
            n = rng.choice(names)
            q = f"{n} buys {qty} pens at {price} pesos each. What is the total cost?"
            ans = price * qty
            exp = f"Total = {price} x {qty} = {ans} pesos."
            hint = "Total cost = price each x number of items."
        elif kind == 3:  # perimeter
            l = rng.randint(5, 25)
            w = rng.randint(3, 15)
            q = f"A rectangle is {l} cm long and {w} cm wide. What is its perimeter?"
            ans = 2 * (l + w)
            exp = f"Perimeter = 2 x ({l} + {w}) = 2 x {l + w} = {ans} cm."
            hint = "Perimeter = 2 x (length + width)."
        elif kind == 4:  # area
            l = rng.randint(4, 15)
            w = rng.randint(3, 12)
            q = f"What is the area of a rectangle {l} m long and {w} m wide?"
            ans = l * w
            exp = f"Area = {l} x {w} = {ans} square meters."
            hint = "Area of a rectangle = length x width."
        elif kind == 5:  # average
            nums = sorted(rng.randint(5, 20) for _ in range(3))
            while sum(nums) % 3 != 0:
                nums = sorted(rng.randint(5, 20) for _ in range(3))
            q = f"Three test scores are {nums[0]}, {nums[1]}, and {nums[2]}. What is the average score?"
            ans = sum(nums) // 3
            exp = f"Average = ({nums[0]} + {nums[1]} + {nums[2]}) / 3 = {sum(nums)} / 3 = {ans}."
            hint = "Average = sum of scores / number of scores."
        elif kind == 6:  # speed x time
            sp = rng.randint(3, 12)
            t = rng.randint(2, 9)
            n = rng.choice(names)
            q = f"{n} walks at {sp} km per hour for {t} hours. How far does {n} travel?"
            ans = sp * t
            exp = f"Distance = {sp} km/h x {t} h = {ans} km."
            hint = "Distance = speed x time."
        else:  # unit price comparison style / remaining
            total = rng.randint(50, 200)
            used = rng.randint(20, total - 10)
            n = rng.choice(names)
            q = f"{n} saves {total} pesos and spends {used} pesos on school supplies. How much is left?"
            ans = total - used
            exp = f"{total} - {used} = {ans} pesos left."
            hint = "'Left' means subtraction."
        if q in seen:
            continue
        seen.add(q)
        distr = sorted({ans + rng.randint(2, 9), ans - rng.randint(2, 9), ans * 2, ans + 10})
        distr = [x for x in distr if x != ans and x > 0][:3]
        while len(distr) < 3:
            distr.append(ans + 3 * len(distr) + 1)
        out.append((q, str(ans), [str(x) for x in distr], exp, hint))
    return out


MATH_GENERATORS = {
    "Multiplication": gen_multiplication,
    "Division": gen_division,
    "Addition": gen_addition,
    "Subtraction": gen_subtraction,
    "Problem Solving": gen_problem_solving,
}

# ---------------------------------------------------------------------------
# Fact pool routing
# ---------------------------------------------------------------------------
def build_fact_pools(questioner):
    pascal = pools.PASCAL + pools_extra.pascal_numeric(
        991 if questioner == "previous" else 7331)
    arch = pools.ARCHIMEDES + pools_extra.ARCH_EXTRA
    mm = pools.MIND_MANIP + pools_extra.MIND_MANIP_EXTRA
    sr = pools.SELF_RES + pools_extra.SELF_RES_EXTRA
    cv = pools.CONVINCE + pools_extra.CONVINCE_EXTRA
    un = pools.UNSTOPPABLE + pools_extra.UNSTOPPABLE_EXTRA
    ohs = pools.OHS_DMA + pools_extra.OHS_EXTRA
    asm = pools.ASSEMBLY + pools_extra.ASM_EXTRA
    win = pools.WINDOWS_INSTALL + pools_extra.WIN_EXTRA
    return {
        ("SCIENCE", "Solid, Liquid, Gas"): pools.SLG,
        ("SCIENCE", "Translational / Rotational Motions"): pools.MOTION,
        ("SCIENCE", "Pascal's Principles"): pascal,
        ("SCIENCE", "Archimedes' Principles"): arch,
        ("SCIENCE", "History"): pools.SCIENCE_HISTORY,
        ("PSYCHOLOGY", "Mind Manipulations"): mm,
        ("PSYCHOLOGY", "Self Resilience"): sr,
        ("PSYCHOLOGY", "Convince Others"): cv,
        ("PSYCHOLOGY", "How to Become Unstoppable"): un,
        ("TECH 1", "System Unit and Its Components"): pools.SYSTEM_UNIT,
        ("TECH 1", "OHS Guidelines and DMA Procedures"): ohs,
        ("TECH 1", "Assemble and Disassemble System Unit"): asm,
        ("TECH 2", "BIOS / CMOS / UEFI"): pools.BIOS,
        ("TECH 2", "Networking"): pools.NETWORKING,
        ("TECH 2", "Windows Installation"): win,
        ("TECH 2", "Safety Procedures"): pools.SAFETY,
    }


def lead_in(questioner, rng):
    if rng.random() < 0.55:
        return rng.choice(NEW_LEAD_INS if questioner == "new" else PREV_LEAD_INS)
    return ""


def sanitize_fact(fact, questioner, rng, used):
    """Return (question, answer, choices, explanation, hint) with shuffled choices."""
    q, a, distr, exp, hint = fact
    distr = list(distr)
    q = lead_in(questioner, rng) + q
    if q in used:
        return None
    choices = [a] + distr
    rng.shuffle(choices)
    # choices must be unique and answer must be present
    if len(set(choices)) != 4 or a not in choices:
        return None
    used.add(q)
    return (q, a, choices, exp, hint or f"Recall the lesson on this topic.")


def build_questioner(questioner):
    """Build all 800 question records for one questioner."""
    seed = 20240517 if questioner == "previous" else 20250814
    rng = random.Random(seed)
    fact_pools = build_fact_pools(questioner)
    # rotate new-questioner pools so the two datasets draw different regions
    if questioner == "new":
        fact_pools = {k: v[len(v) // 3:] + v[:len(v) // 3] for k, v in fact_pools.items()}
        fact_pools = {k: rng.sample(v, len(v)) for k, v in fact_pools.items()}
    else:
        fact_pools = {k: rng.sample(v, len(v)) for k, v in fact_pools.items()}

    pool_cursor = {k: 0 for k in fact_pools}
    used_text = set()
    records = []

    for subject, topics in CATALOG.items():
        for quiz_type in ("SUBJECT 1", "SUBJECT 2"):
            level = 0
            for topic, n in topics:
                for _ in range(n):
                    level += 1
                    if subject == "MATH":
                        gen = MATH_GENERATORS[topic]
                        items = gen(rng, 1)
                        q, a, choices_raw, exp, hint = items[0]
                        while q in used_text:
                            q, a, choices_raw, exp, hint = gen(rng, 1)[0]
                        used_text.add(q)
                        choices = [a] + choices_raw
                        rng.shuffle(choices)
                    else:
                        key = (subject, topic)
                        pool = fact_pools[key]
                        cursor = pool_cursor[key]
                        fact = None
                        while cursor < len(pool):
                            candidate = sanitize_fact(pool[cursor], questioner, rng, used_text)
                            cursor += 1
                            if candidate is not None:
                                fact = candidate
                                break
                        pool_cursor[key] = cursor
                        if fact is None:
                            raise SystemExit(
                                f"Pool exhausted for {questioner}/{subject}/{topic} "
                                f"(needed {n} per path). Pool size {len(pool)}.")
                        q, a, choices, exp, hint = fact
                    records.append({
                        "id": f"{questioner[:4]}-{SUBJECT_SLUG[subject]}-{QUIZ_SLUG[quiz_type]}-l{level:02d}",
                        "subject": subject,
                        "quizType": quiz_type,
                        "level": level,
                        "topic": topic,
                        "question": q,
                        "choices": choices,
                        "answer": a,
                        "explanation": exp,
                        "hint": hint,
                    })
    return records


def validate_bank(records, questioner):
    assert len(records) == 800, f"{questioner}: expected 800 records, got {len(records)}"
    ids = set()
    texts = set()
    for r in records:
        assert r["id"] not in ids, f"duplicate id {r['id']}"
        ids.add(r["id"])
        assert r["question"] not in texts, f"duplicate question text in {questioner}: {r['question'][:60]}"
        texts.add(r["question"])
        assert len(r["choices"]) == 4, f"{r['id']}: needs 4 choices"
        assert len(set(r["choices"])) == 4, f"{r['id']}: choices not unique"
        assert r["answer"] in r["choices"], f"{r['id']}: answer not in choices"
        assert 1 <= r["level"] <= 80, f"{r['id']}: bad level"
        for f in ("subject", "quizType", "topic", "question", "explanation", "hint"):
            assert isinstance(r[f], str) and r[f].strip(), f"{r['id']}: empty {f}"
    # distribution check
    from collections import Counter
    counts = Counter((r["subject"], r["quizType"], r["topic"]) for r in records)
    for subject, topics in CATALOG.items():
        for topic, n in topics:
            for quiz in ("SUBJECT 1", "SUBJECT 2"):
                got = counts[(subject, quiz, topic)]
                assert got == n, f"{questioner} {subject}/{quiz}/{topic}: expected {n}, got {got}"
    print(f"  {questioner}: 800 records OK, distributions exact, ids/texts unique, answers valid")


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    banks = {}
    for questioner in ("previous", "new"):
        records = build_questioner(questioner)
        validate_bank(records, questioner)
        banks[questioner] = records

    prev_doc = {"schemaVersion": 1, "questioner": "previous", "questions": banks["previous"]}
    new_doc = {"schemaVersion": 1, "questioner": "new", "questions": banks["new"]}

    with open(os.path.join(root, "questions.json"), "w", encoding="utf-8") as f:
        json.dump(prev_doc, f, ensure_ascii=False, indent=1)
    with open(os.path.join(root, "questions.new.json"), "w", encoding="utf-8") as f:
        json.dump(new_doc, f, ensure_ascii=False, indent=1)

    with open(os.path.join(root, "questions.embedded.js"), "w", encoding="utf-8") as f:
        f.write("// GEON'S GAMEHUB - embedded Previous question bank (offline/file:// fallback)\n")
        f.write("window.GEON_QUESTIONS_PREVIOUS = ")
        json.dump(prev_doc, f, ensure_ascii=False)
        f.write(";\n")
    with open(os.path.join(root, "questions.new.embedded.js"), "w", encoding="utf-8") as f:
        f.write("// GEON'S GAMEHUB - embedded New question bank (offline/file:// fallback)\n")
        f.write("window.GEON_QUESTIONS_NEW = ")
        json.dump(new_doc, f, ensure_ascii=False)
        f.write(";\n")

    # cross-questioner overlap report (informational)
    prev_t = {r["question"] for r in banks["previous"]}
    new_t = {r["question"] for r in banks["new"]}
    print(f"  cross-questioner duplicate question texts: {len(prev_t & new_t)}")
    print("Generated: questions.json, questions.new.json, questions.embedded.js, questions.new.embedded.js")


if __name__ == "__main__":
    main()
