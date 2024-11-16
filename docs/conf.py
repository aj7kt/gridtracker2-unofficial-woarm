# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information

project = 'GridTracker2'
copyright = '%Y, GridTracker.org'
author = "Stephen “Tag” Loomis N0TTL\n Henry “atouk” Forte N2VFL\n And the GridTracker.org team"
version = '2.24.1115.0'

# -- General configuration ---------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#general-configuration

extensions = ['myst_parser']

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']
myst_heading_anchors = 7


# -- Options for LaTeX output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-latex-output

latex_logo = 'img/GridTracker_logo.png'
latex_engine = "xelatex"
latex_elements = {
    # Fix Unicode handling by disabling the defaults for a few items
    # set by sphinx
    'inputenc': '',
    'utf8extra': '',
}
latex_documents = [
    ('index',
    'GridTracker2.tex',
    'GridTracker2',
    'Stephen “Tag” Loomis N0TTL\\and Henry “atouk” Forte N2VFL\\and And the GridTracker.org team',
    'manual')
]

# -- Options for HTML output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-html-output

html_theme = 'alabaster'
html_static_path = ['_static']
html_show_copyright = True
