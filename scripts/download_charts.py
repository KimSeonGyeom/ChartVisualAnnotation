"""
ChartCap 데이터셋 다운로드
"""

from datasets import load_dataset
import os
import json

NUM_SAMPLES = 1000
SAVE_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "images")
DATA_OUTPUT = os.path.join(os.path.dirname(__file__), "..", "public", "chartcap_data.json")


def main():
    print("Loading ChartCap dataset...")
    dataset = load_dataset("junyoung-00/ChartCap", split="train", streaming=True)

    os.makedirs(SAVE_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(DATA_OUTPUT), exist_ok=True)

    all_data = []

    for i, item in enumerate(dataset):
        if i >= NUM_SAMPLES:
            break

        filename = f"chart_{i + 1}.png"
        filepath = os.path.join(SAVE_DIR, filename)

        # 이미지 저장
        item['image'].save(filepath)

        # 모든 데이터 저장
        all_data.append({
            "index": i + 1,
            "filename": filename,
            "original_filename": item.get('image_filename', ''),
            "caption": item.get('caption', ''),
            "chart_info": item.get('chart_info', ''),
        })

        if (i + 1) % 50 == 0:
            print(f"[{i + 1}/{NUM_SAMPLES}]")

    # JSON 저장
    with open(DATA_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Done! {len(all_data)} items saved.")
    print(f"   Images: {SAVE_DIR}")
    print(f"   Data: {DATA_OUTPUT}")


if __name__ == "__main__":
    main()
