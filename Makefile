# Build site/index.html from content/index.md with pandoc and the academic-site-template (theme/).
#   make                 build the page and copy the template's assets into site/
#   make THEME=~/academic-site-template    use a local template checkout instead of the submodule
#   make serve           build, then serve on http://0.0.0.0:8765
PANDOC ?= pandoc
THEME  ?= theme
PY     ?= ~/miniforge3/envs/nma/bin/python

all: site/index.html site/assets

site/index.html: content/index.md content/site.yaml content/references.bib content/ams.csl $(THEME)/templates/page.html
	$(PANDOC) $< -o $@ --standalone --template $(THEME)/templates/page.html \
	  --metadata-file content/site.yaml --lua-filter $(THEME)/filters/crossref.lua \
	  --citeproc --bibliography content/references.bib --section-divs

site/assets: $(shell find $(THEME)/assets -type f 2>/dev/null)
	rm -rf site/assets && cp -r $(THEME)/assets site/assets

serve: all
	$(PY) pipeline/serve.py

.PHONY: all serve
