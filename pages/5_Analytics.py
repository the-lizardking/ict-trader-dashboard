import streamlit as st
import plotly.express as px
from data_sources import FakeDataSource
st.set_page_config(page_title="Analytics", layout="wide")
ds = FakeDataSource()
st.title("📈 Analytics")
series = ds.get_analytics_series()
fig = px.line(series["equity"], x="date", y="equity")
st.plotly_chart(fig, use_container_width=True)
st.dataframe(series["equity"].tail())
