"""Copy upstream translations and the pinned workbench component labels."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
output = root / "ui/components/labels"
output.mkdir(parents=True, exist_ok=True)
catalogues = {}
workbench = json.loads((output / "workbench.json").read_text(encoding="utf-8"))["catalogues"]
for language, filename in [("zh", "zh_CN"), ("en", "en_US"), ("ja", "ja_JP")]:
    tree = ET.parse(root / f"vendor/MiaCode/translations/{filename}.ts")
    labels = {}
    for message in tree.findall(".//message"):
        identifier = message.get("id")
        translation = message.find("translation")
        if identifier and identifier not in {"action.batch_export", "qml.batch"} and not identifier.startswith("dialog.batch_export."):
            value = "".join(translation.itertext()) if translation is not None else ""
            labels[identifier] = value or message.findtext("source", "")
    labels.update(workbench[language])
    (output / f"{language}.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    catalogues[language] = labels
    print(f"UI labels {language}: {len(labels)}")
(output.parent / "labels.mjs").write_text("export const catalogues = " + json.dumps(catalogues, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
